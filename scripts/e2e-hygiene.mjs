// End-to-end check of the upload pipeline against a running app, signed in like a browser.
// usage: node --env-file=.env.local scripts/e2e-hygiene.mjs http://localhost:3007 public/samples/NSF_Q4-2026_rollout.kmz [planner|partner]
import { createServerClient } from '@supabase/ssr'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const [base = 'http://localhost:3007', file = 'public/samples/NSF_Q4-2026_rollout.kmz', who = 'planner'] = process.argv.slice(2)
const email = { planner: 'planner@homepass-atlas.demo', partner: 'nsf@homepass-atlas.demo', viewer: 'viewer@homepass-atlas.demo' }[who]
const jar = new Map()
const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: l => l.forEach(c => jar.set(c.name, c.value)) },
})
const { error } = await supabase.auth.signInWithPassword({ email, password: process.env.ATLAS_DEMO_PASSWORD })
if (error) throw error
const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
const api = async (path, init = {}) => {
  const r = await fetch(base + path, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, j }
}

const bytes = readFileSync(file)
const t0 = Date.now()
const s = await api('/api/uploads/sign', { method: 'POST', body: JSON.stringify({ filename: basename(file), size: bytes.length }) })
console.log('sign', s.status, s.j.error ?? '')
if (s.status !== 200) process.exit(1)
const up = await supabase.storage.from('atlas-uploads').uploadToSignedUrl(s.j.path, s.j.token, bytes, { contentType: 'application/octet-stream' })
console.log('upload', up.error?.message ?? 'ok')
const b = await api('/api/batches', { method: 'POST', body: JSON.stringify({ path: s.j.path, filename: basename(file), partnerId: 1, sliverM2: 500 }) })
console.log('batch', b.status, b.j)
if (b.status !== 200) process.exit(1)
for (let i = 0; i < 90; i++) {
  const d = await api(`/api/batches/${b.j.id}`)
  const done = d.j.shards?.filter(x => x.status === 'done').length
  process.stdout.write(`\r${d.j.batch.status} ${done}/${d.j.batch.shards_total}   `)
  if (['done', 'failed'].includes(d.j.batch.status)) {
    console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(d.j.batch.stats))
    console.log('workers', [...new Set(d.j.shards.map(x => x.worker))])
    if (d.j.batch.error) console.log('error', d.j.batch.error)
    break
  }
  await new Promise(r => setTimeout(r, 1000))
}
