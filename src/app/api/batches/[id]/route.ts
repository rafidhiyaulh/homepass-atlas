import { apiError, apiMe, HttpError } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { UUID } from '@/lib/guard'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await apiMe()
    const { id } = await params
    if (!UUID.test(id)) throw new HttpError(400, 'bad_request')
    const data = await asUser(me, async tx => {
      const [batch] = await tx`
        select b.id, b.filename, b.status, b.polygons, b.shards_total, b.sliver_m2, b.created_at, b.started_at, b.finished_at,
               b.stats, b.error, b.partner_id, p.code as partner_code, p.name as partner_name
        from atlas.batches b left join atlas.partners p on p.id = b.partner_id where b.id = ${id}`
      if (!batch) return null
      const shards = await tx`select shard, lo, hi, status, attempts, worker, ms, last_error from atlas.batch_shards where batch_id = ${id} order by shard`
      const boundaries = batch.status === 'done' ? await tx`
        select id, seq, name, folder, status, kinds, conflict_count, is_valid, valid_reason,
               round(area_m2) as area_m2, round(clean_area_m2) as clean_area_m2, homepass_est,
               props ->> 'homepass_claimed' as homepass_claimed
        from atlas.boundaries where batch_id = ${id} order by seq` : []
      const conflicts = batch.status === 'done' ? await tx`
        select c.a_id, a.name as a_name, c.b_kind, c.b_id,
               case when c.b_kind = 'batch' then b.name else 'Live area #' || c.b_id end as b_name,
               c.kind, round(c.overlap_m2) as overlap_m2, c.homepass_dup
        from atlas.conflicts c join atlas.boundaries a on a.id = c.a_id
        left join atlas.boundaries b on c.b_kind = 'batch' and b.id = c.b_id
        where c.batch_id = ${id} order by c.overlap_m2 desc` : []
      return { batch, shards, boundaries, conflicts }
    })
    if (!data) throw new HttpError(404, 'not_found')
    return Response.json(data)
  } catch (e) {
    return apiError(e)
  }
}
