import { createHash } from 'node:crypto'
import { after } from 'next/server'
import { apiError, apiMe, HttpError } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { audit, rateLimit } from '@/lib/guard'
import { storageAdmin } from '@/lib/admin'
import { extractKml, parseKml, UploadError } from '@/lib/kmz'
import { kickWorkers } from '@/lib/worker'

export const maxDuration = 60

export async function GET() {
  try {
    const me = await apiMe()
    const rows = await asUser(me, tx => tx`
      select b.id, b.filename, b.status, b.polygons, b.shards_total, b.created_at, b.finished_at, b.stats, b.error,
             p.code as partner_code, b.partner_id,
             (select count(*) from atlas.batch_shards s where s.batch_id = b.id and s.status = 'done')::int as shards_done
      from atlas.batches b left join atlas.partners p on p.id = b.partner_id
      order by b.created_at desc limit 50`)
    return Response.json({ batches: rows })
  } catch (e) {
    return apiError(e)
  }
}

// Step 2 of an upload: fetch the stored file, unpack + parse it defensively, write the batch
// through RLS, enqueue its shards, and fan out workers after the response is sent.
export async function POST(request: Request) {
  try {
    const me = await apiMe()
    if (me.role === 'viewer') throw new HttpError(403, 'forbidden', 'Viewers cannot upload')
    await rateLimit(me, 'batch', 20, 3600)
    const body = await request.json()
    const path = String(body?.path ?? '')
    const filename = String(body?.filename ?? '').slice(0, 120).replace(/[^\p{L}\p{N} _.()\-]/gu, '_')
    if (!path.startsWith(`${me.sub}/`) || path.includes('..')) throw new HttpError(400, 'bad_path', 'Unknown upload')
    const sliver = Number(body?.sliverM2 ?? 500)
    if (!Number.isFinite(sliver) || sliver < 0 || sliver > 20000) throw new HttpError(400, 'bad_request', 'Sliver threshold 0-20,000 m²')
    const partnerId = me.role === 'partner' ? me.partner_id : Number(body?.partnerId)
    if (!partnerId || partnerId < 1 || partnerId > 32767) throw new HttpError(400, 'bad_request', 'Choose the partner who submitted the file')

    const { data: blob, error } = await storageAdmin().download(path)
    if (error || !blob) throw new HttpError(400, 'bad_path', 'Upload not found')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const sha256 = createHash('sha256').update(bytes).digest('hex')

    let parsed
    try {
      parsed = parseKml(extractKml(bytes, filename))
    } catch (e) {
      if (e instanceof UploadError) {
        await audit(me, 'upload.rejected', filename, { code: e.code, sha256 })
        throw new HttpError(422, e.code, e.message)
      }
      throw e
    }

    const [row] = await asUser(me, tx => tx`
      select atlas.create_batch(${filename}, ${sha256}, ${partnerId}, ${path}, ${tx.json(parsed.features as never)}, ${sliver}) as id`)
    const [b] = await asUser(me, tx => tx`select shards_total, status from atlas.batches where id = ${row.id}`)

    if (b.status === 'queued') after(() => kickWorkers(new URL(request.url).origin, Math.min(4, b.shards_total), 'upload'))
    return Response.json({ id: row.id, polygons: parsed.features.length, skipped: parsed.skipped, shards: b.shards_total, status: b.status })
  } catch (e) {
    return apiError(e)
  }
}
