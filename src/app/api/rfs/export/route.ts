import { zipSync, strToU8 } from 'fflate'
import { apiError, apiMe, HttpError } from '@/lib/auth'
import { asUser } from '@/lib/db'

// Candidate RFS cells as KMZ for a field survey, one placemark per cell with its numbers.
export async function GET(request: Request) {
  try {
    const me = await apiMe()
    const q = new URL(request.url).searchParams
    const reco = q.get('reco') ?? 'build'
    const kota = q.get('kota') ?? 'all'
    if (!['build', 'fwa', 'hold', 'all'].includes(reco) || kota.length > 60) throw new HttpError(400, 'bad_request')
    const rows = await asUser(me, tx => tx`
      select h3, kota, homepass_est, round((pred_takeup_m12 * 100)::numeric, 1) as p12, payback_months, rfs_reco, round(rfs_score::numeric) as score,
             ST_AsGeoJSON(geom, 7)::json as g
      from atlas.h3_cells
      where covered_area_id is null and (${reco} = 'all' or rfs_reco = ${reco}) and (${kota} = 'all' or kota = ${kota})
      order by rfs_score desc limit 500`)
    const marks = rows.map(r => {
      const ring = (r.g.coordinates[0] as number[][]).map(c => `${c[0]},${c[1]},0`).join(' ')
      return `<Placemark><name>${r.h3}</name><ExtendedData>${[['kota', r.kota], ['homepass_est', r.homepass_est], ['takeup_m12_pct', r.p12], ['payback_months', r.payback_months ?? ''], ['recommendation', r.rfs_reco], ['score', r.score]]
        .map(([k, v]) => `<Data name="${k}"><value>${String(v).replace(/[<&]/g, '')}</value></Data>`).join('')}</ExtendedData><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`
    })
    const kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>RFS candidates (${reco})</name>${marks.join('\n')}</Document></kml>`
    return new Response(Buffer.from(zipSync({ 'doc.kml': strToU8(kml) })), {
      headers: { 'content-type': 'application/vnd.google-earth.kmz', 'content-disposition': `attachment; filename="rfs_candidates_${reco}.kmz"` },
    })
  } catch (e) {
    return apiError(e)
  }
}
