import 'server-only'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { asWorker } from './db'

// Competing consumers on the pgmq queue `atlas_shards`. Any number of these can run at once
// (separate serverless invocations); a message is invisible to others for VT seconds after a
// read, and comes back automatically if the worker dies before acknowledging it.
const VT = 60
const MAX_ATTEMPTS = 3

export async function runWorker(trigger: string, budgetMs = 40000) {
  const worker = `w-${randomUUID().slice(0, 8)}`
  const deadline = Date.now() + budgetMs
  const [{ id: runId }] = await asWorker(tx => tx`select atlas.worker_run_start(${worker}, ${trigger}) as id`)
  let processed = 0
  let failed = 0
  while (Date.now() < deadline) {
    const [msg] = await asWorker(tx => tx`select msg_id, read_ct from atlas.q_read(${VT}, 1)`)
    if (!msg) break
    try {
      await asWorker(tx => tx`select atlas.process_shard(${msg.msg_id}, ${worker})`)
      processed++
    } catch (e) {
      failed++
      const verdict = await asWorker(tx => tx`select atlas.shard_failed(${msg.msg_id}, ${msg.read_ct}, ${String((e as Error).message)}, ${MAX_ATTEMPTS}) as v`)
      console.error('shard failed', worker, msg.msg_id, verdict[0]?.v, (e as Error).message)
    }
  }
  await asWorker(tx => tx`select atlas.worker_run_end(${runId}, ${processed}, ${failed})`)
  return { worker, processed, failed }
}

export function workerAuthorized(req: Request) {
  const secret = process.env.ATLAS_WORKER_SECRET ?? ''
  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '')
  const a = Buffer.from(got)
  const b = Buffer.from(secret)
  return secret.length > 0 && a.length === b.length && timingSafeEqual(a, b)
}

// Fan out: n independent HTTP invocations of /api/worker, each its own function instance.
export async function kickWorkers(origin: string, n: number, trigger: string) {
  const url = new URL('/api/worker', process.env.ATLAS_PUBLIC_URL || origin)
  await Promise.allSettled(
    Array.from({ length: n }, () =>
      fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.ATLAS_WORKER_SECRET}`, 'content-type': 'application/json' },
        body: JSON.stringify({ trigger }),
        signal: AbortSignal.timeout(55000),
      }),
    ),
  )
}
