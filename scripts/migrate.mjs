// Apply db/migrations/*.sql in order as the admin role; each file runs once, in its own transaction.
// Also (re)sets the atlas_app login password from ATLAS_APP_PASSWORD.
import postgres from 'postgres'
import { readFileSync, readdirSync } from 'node:fs'

const url = process.env.DATABASE_ADMIN_URL
if (!url) throw new Error('DATABASE_ADMIN_URL not set')
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} })

await sql`create schema if not exists atlas`
await sql`create table if not exists atlas.schema_migrations (name text primary key, applied_at timestamptz not null default now())`
const done = new Set((await sql`select name from atlas.schema_migrations`).map(r => r.name))
const only = process.argv[2]

for (const name of readdirSync('db/migrations').filter(f => f.endsWith('.sql')).sort()) {
  if (done.has(name) && name !== only) continue
  const text = readFileSync(`db/migrations/${name}`, 'utf8')
  process.stdout.write(`apply ${name} ... `)
  await sql.begin(async tx => {
    await tx.unsafe(text)
    await tx`insert into atlas.schema_migrations (name) values (${name}) on conflict (name) do update set applied_at = now()`
  })
  console.log('ok')
}

if (process.env.ATLAS_APP_PASSWORD) {
  await sql.unsafe(`alter role atlas_app with login password '${process.env.ATLAS_APP_PASSWORD.replace(/'/g, "''")}'`)
  console.log('atlas_app password set')
}
await sql.end()
