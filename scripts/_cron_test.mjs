import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_ADMIN_URL, { prepare: false, max: 1, onnotice: () => {} })
const [b] = await sql`select id from atlas.batches where status = 'done' order by created_at desc limit 1`
const [m] = await sql`select pgmq.send('atlas_shards', ${sql.json({ batch_id: b.id, shard: 0, lo: 1, hi: 1 })}) as id`
console.log('sent msg', m.id, 'at', new Date().toISOString())
const t0 = Date.now()
while (Date.now() - t0 < 150000) {
  const r = await sql`select worker, started_at, processed from atlas.worker_runs where trigger = 'cron' and started_at > now() - interval '3 minutes' order by id desc limit 1`
  const [q] = await sql`select queue_length from pgmq.metrics('atlas_shards')`
  if (r.length && Number(q.queue_length) === 0) { console.log('cron worker ran:', r[0], 'queue now', q.queue_length, `after ${((Date.now() - t0) / 1000).toFixed(0)}s`); break }
  await new Promise(res => setTimeout(res, 5000))
}
const runs = await sql`select status, return_message, start_time from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'atlas-worker-sweep' order by start_time desc limit 2`
console.log(runs)
await sql.end()
