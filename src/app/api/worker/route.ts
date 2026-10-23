import { runWorker, workerAuthorized } from '@/lib/worker'

export const maxDuration = 60

// Called by the upload fan-out and by pg_cron (safety net). Bearer secret only, never a user session.
export async function POST(request: Request) {
  if (!workerAuthorized(request)) return Response.json({ error: 'forbidden' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const trigger = typeof body?.trigger === 'string' ? body.trigger.slice(0, 20) : 'http'
  const result = await runWorker(trigger)
  return Response.json(result)
}
