// Feed hostile files through the real upload path and expect clean rejections.
// usage: node --env-file=.env.local scripts/check-upload-guards.mjs http://localhost:3007
import { createServerClient } from '@supabase/ssr'
import { zipSync, strToU8 } from 'fflate'
const base = process.argv[2] ?? 'http://localhost:3007'
const jar = new Map()
const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: l => l.forEach(c => jar.set(c.name, c.value)) },
})
await sb.auth.signInWithPassword({ email: 'planner@homepass-atlas.demo', password: process.env.ATLAS_DEMO_PASSWORD })
const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
const api = (p, body) => fetch(base + p, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json() }))

async function tryUpload(name, bytes) {
  const s = await api('/api/uploads/sign', { filename: name, size: bytes.length })
  if (s.status !== 200) return s
  await sb.storage.from('atlas-uploads').uploadToSignedUrl(s.j.path, s.j.token, bytes, { contentType: 'application/octet-stream' })
  return api('/api/batches', { path: s.j.path, filename: name, partnerId: 1, sliverM2: 500 })
}

const xxe = `<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY x SYSTEM "file:///etc/passwd">]><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>&x;</name><Polygon><outerBoundaryIs><LinearRing><coordinates>106.8,-6.2 106.81,-6.2 106.81,-6.21 106.8,-6.2</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`
const bomb = zipSync({ 'doc.kml': new Uint8Array(200 * 1024 * 1024) }, { level: 9 })   // 200 MB of zeros
const cases = [
  ['XXE entity in KML', 'xxe.kmz', zipSync({ 'doc.kml': strToU8(xxe) }), 'dtd_rejected'],
  ['zip bomb (200 MB inflated)', 'bomb.kmz', bomb, 'zip_bomb'],
  ['not a zip, wrong extension', 'fake.kmz', strToU8('hello'), 'bad_format'],
  ['KMZ without polygons', 'points.kmz', zipSync({ 'doc.kml': strToU8('<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><Point><coordinates>106.8,-6.2</coordinates></Point></Placemark></kml>') }), 'no_polygons'],
  ['broken XML', 'broken.kmz', zipSync({ 'doc.kml': strToU8('<kml><Placemark>') }), 'bad_xml'],
]
console.log('bomb archive size', bomb.length, 'bytes')
for (const [label, name, bytes, want] of cases) {
  const r = await tryUpload(name, bytes)
  console.log(r.j?.code === want ? 'PASS' : 'FAIL', label, r.status, r.j?.code, r.j?.error ?? '')
}
