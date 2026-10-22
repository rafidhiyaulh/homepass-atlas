// Run SQL against DATABASE_URL: node scripts/sql.mjs "select 1"  |  node scripts/sql.mjs -f file.sql
import postgres from 'postgres'
import { readFileSync } from 'node:fs'
const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} })
const args = process.argv.slice(2)
const text = args[0] === '-f' ? readFileSync(args[1], 'utf8') : args.join(' ')
try {
  const res = await sql.unsafe(text).simple()
  const sets = Array.isArray(res[0]) || res.length === 0 ? res : [res]
  for (const rows of [].concat(Array.isArray(res) && res.every(Array.isArray) ? res : [res])) {
    if (rows.length) console.table(rows.slice(0, 60))
  }
} catch (e) { console.error('ERROR:', e.message); process.exitCode = 1 } finally { await sql.end() }
