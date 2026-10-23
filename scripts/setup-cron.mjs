// Safety net for the worker fan-out: every minute, if the shard queue is not empty, pg_cron calls
// /api/worker through pg_net. The bearer secret lives in Supabase Vault, never in a migration file.
// usage: node --env-file=.env.local scripts/setup-cron.mjs https://homepass-atlas.vercel.app
import postgres from 'postgres'
const url = process.argv[2]
if (!url?.startsWith('https://')) throw new Error('pass the public https URL')
const sql = postgres(process.env.DATABASE_ADMIN_URL, { prepare: false, max: 1, onnotice: () => {} })
await sql`insert into atlas.settings (key, value) values ('worker_url', ${url + '/api/worker'})
          on conflict (key) do update set value = excluded.value`
const [s] = await sql`select id from vault.secrets where name = 'atlas_worker_secret'`
if (s) await sql`select vault.update_secret(${s.id}, ${process.env.ATLAS_WORKER_SECRET})`
else await sql`select vault.create_secret(${process.env.ATLAS_WORKER_SECRET}, 'atlas_worker_secret', 'HomePass Atlas worker bearer')`
await sql.unsafe(`select cron.unschedule('atlas-worker-sweep') where exists (select 1 from cron.job where jobname = 'atlas-worker-sweep')`)
await sql.unsafe(`select cron.schedule('atlas-worker-sweep', '* * * * *', $job$
  select net.http_post(
    url := (select value from atlas.settings where key = 'worker_url'),
    headers := jsonb_build_object('content-type', 'application/json',
      'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'atlas_worker_secret')),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 55000)
  where (select queue_length from pgmq.metrics('atlas_shards')) > 0
$job$)`)
console.log(await sql`select jobname, schedule, active from cron.job where jobname = 'atlas-worker-sweep'`)
await sql.end()
