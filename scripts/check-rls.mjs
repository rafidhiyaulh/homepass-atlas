// Verify row-level security through the real API: each role sees only what it should.
// usage: node --env-file=.env.local scripts/check-rls.mjs http://localhost:3007
import { createServerClient } from '@supabase/ssr'
const base = process.argv[2] ?? 'http://localhost:3007'
async function as(email) {
  const jar = new Map()
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: l => l.forEach(c => jar.set(c.name, c.value)) },
  })
  const { error } = await sb.auth.signInWithPassword({ email, password: process.env.ATLAS_DEMO_PASSWORD })
  if (error) throw error
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  return (path, init = {}) => fetch(base + path, { ...init, headers: { cookie, 'content-type': 'application/json' } }).then(async r => ({ status: r.status, j: await r.json().catch(() => null) }))
}
const planner = await as('planner@homepass-atlas.demo')
const partner = await as('nsf@homepass-atlas.demo')
const viewer = await as('viewer@homepass-atlas.demo')
const check = (name, ok, detail) => console.log(ok ? 'PASS' : 'FAIL', name, detail ?? '')

const pb = (await planner('/api/batches')).j.batches
const nb = (await partner('/api/batches')).j.batches
check('planner sees all batches', pb.length >= 2, pb.map(b => b.partner_code).join(','))
check('partner sees only own batches', nb.every(b => b.partner_code === 'NSF') && nb.length < pb.length, nb.map(b => b.partner_code).join(','))
const jop = pb.find(b => b.partner_code === 'JOP')
if (jop) check('partner cannot open another partner batch', (await partner(`/api/batches/${jop.id}`)).status === 404)
const ask = await partner('/api/ask', { method: 'POST', body: JSON.stringify({ q: 'all areas sorted by take-up, limit 100' }) })
check('partner Ask returns only own areas', ask.status === 200 && ask.j.rows.every(r => String(r.code).startsWith('NSF')), `${ask.j?.rows?.length} rows`)
check('viewer cannot upload', (await viewer('/api/uploads/sign', { method: 'POST', body: JSON.stringify({ filename: 'x.kmz', size: 10 }) })).status === 403)
check('partner cannot promote', (await partner(`/api/batches/${pb[0].id}/promote`, { method: 'POST' })).status === 403)
check('worker endpoint rejects users', (await planner('/api/worker', { method: 'POST' })).status === 403)
check('anonymous API is 401', (await fetch(base + '/api/batches')).status === 401)
