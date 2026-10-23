import { zipSync, strToU8 } from 'fflate'
import { apiError, apiMe, HttpError } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { UUID } from '@/lib/guard'

const esc = (s: string) => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)

// KML colour is aabbggrr
const STYLE: Record<string, string> = { clean: 'ff9ab312', touch: 'ff8f6b5a', sliver: 'ff0ec2ff', overlap: 'ff006ae0', duplicate: 'ff2e26e2', invalid: 'ff2e26e2', clean_part: 'ff9ab312' }

type Geo = { type: string; coordinates: number[][][] | number[][][][] }
function placemarkGeometry(g: Geo) {
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as number[][][][]
  const poly = (p: number[][][]) =>
    '<Polygon>' + p.map((ring, i) =>
      `<${i === 0 ? 'outerBoundaryIs' : 'innerBoundaryIs'}><LinearRing><coordinates>${ring.map(c => `${c[0]},${c[1]},0`).join(' ')}</coordinates></LinearRing></${i === 0 ? 'outerBoundaryIs' : 'innerBoundaryIs'}>`).join('') + '</Polygon>'
  return polys.length === 1 ? poly(polys[0]) : `<MultiGeometry>${polys.map(poly).join('')}</MultiGeometry>`
}

// what=clean       polygons with status clean (+ touch), unchanged
// what=clean_parts every polygon cut down to the part nobody else claims
// what=issues      everything that is not clean, with its status
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await apiMe()
    const { id } = await params
    if (!UUID.test(id)) throw new HttpError(400, 'bad_request')
    const what = new URL(request.url).searchParams.get('what') ?? 'clean'
    if (!['clean', 'clean_parts', 'issues'].includes(what)) throw new HttpError(400, 'bad_request')
    const { batch, rows } = await asUser(me, async tx => {
      const [batch] = await tx`select filename, status from atlas.batches where id = ${id}`
      if (!batch || batch.status !== 'done') return { batch, rows: [] }
      const rows = what === 'clean'
        ? await tx`select name, status, homepass_est, ST_AsGeoJSON(geom, 7)::json as g from atlas.boundaries where batch_id = ${id} and status in ('clean', 'touch') order by seq`
        : what === 'clean_parts'
          ? await tx`select name, 'clean_part' as status, homepass_est, ST_AsGeoJSON(clean_geom, 7)::json as g from atlas.boundaries where batch_id = ${id} and clean_geom is not null and not ST_IsEmpty(clean_geom) and is_valid order by seq`
          : await tx`select name, status, homepass_est, ST_AsGeoJSON(geom, 7)::json as g from atlas.boundaries where batch_id = ${id} and status not in ('clean', 'touch') order by seq`
      return { batch, rows }
    })
    if (!batch) throw new HttpError(404, 'not_found')
    if (batch.status !== 'done') throw new HttpError(409, 'not_ready', 'Batch is still processing')

    const styles = Object.entries(STYLE).map(([k, c]) => `<Style id="${k}"><LineStyle><color>${c}</color><width>2</width></LineStyle><PolyStyle><color>55${c.slice(2)}</color></PolyStyle></Style>`).join('')
    const marks = rows.map(r =>
      `<Placemark><name>${esc(r.name)}</name><styleUrl>#${r.status}</styleUrl><ExtendedData><Data name="status"><value>${r.status}</value></Data><Data name="homepass_est"><value>${r.homepass_est ?? ''}</value></Data></ExtendedData>${placemarkGeometry(r.g)}</Placemark>`).join('\n')
    const base = String(batch.filename).replace(/\.(kmz|kml)$/i, '')
    const kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(base)} - ${what}</name>${styles}\n${marks}\n</Document></kml>`
    const kmz = zipSync({ 'doc.kml': strToU8(kml) })
    return new Response(Buffer.from(kmz), {
      headers: {
        'content-type': 'application/vnd.google-earth.kmz',
        'content-disposition': `attachment; filename="${base.replace(/[^\w.\-]/g, '_')}_${what}.kmz"`,
      },
    })
  } catch (e) {
    return apiError(e)
  }
}
