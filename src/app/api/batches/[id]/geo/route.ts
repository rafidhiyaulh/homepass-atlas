import { apiError, apiMe, HttpError } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { UUID } from '@/lib/guard'

// GeoJSON for the batch map: the polygons, the overlap shapes, and registry areas around them.
// Registry areas come through RLS, so a partner only sees its own; others appear only as overlaps.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await apiMe()
    const { id } = await params
    if (!UUID.test(id)) throw new HttpError(400, 'bad_request')
    const data = await asUser(me, async tx => {
      const boundaries = await tx`
        select id, seq, name, status, ST_AsGeoJSON(geom, 6)::json as geom from atlas.boundaries where batch_id = ${id} order by seq`
      const overlaps = await tx`
        select a_id || ':' || b_kind || ':' || b_id as id, kind, round(overlap_m2) as overlap_m2,
               ST_AsGeoJSON(geom, 6)::json as geom
        from atlas.conflicts where batch_id = ${id} and kind <> 'touch' and geom is not null and not ST_IsEmpty(geom)`
      const registry = await tx`
        select r.id, r.code, r.partner_id, ST_AsGeoJSON(ST_SimplifyPreserveTopology(r.geom, 0.00005), 6)::json as geom
        from atlas.areas r
        where r.geom && (select ST_Expand(ST_Extent(geom)::geometry, 0.02) from atlas.boundaries where batch_id = ${id})`
      return { boundaries, overlaps, registry }
    })
    return Response.json(data)
  } catch (e) {
    return apiError(e)
  }
}
