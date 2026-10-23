import 'server-only'
import { asUser } from './db'
import { HttpError, type Me } from './auth'

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Per-user fixed-window limit, counted in Postgres so it holds across all serverless instances.
export async function rateLimit(me: Me, bucket: string, max: number, windowS: number) {
  const [r] = await asUser(me, tx => tx`select atlas.hit(${bucket + ':' + me.sub}, ${max}, ${windowS}) as ok`)
  if (!r.ok) throw new HttpError(429, 'rate_limited', 'Too many requests, slow down a little.')
}

export async function audit(me: Me, action: string, target: string, detail: object = {}) {
  await asUser(me, tx => tx`select atlas.audit(${action}, ${target}, ${tx.json(detail as never)})`)
}
