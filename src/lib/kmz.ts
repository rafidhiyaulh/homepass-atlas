import 'server-only'
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'
import { kmlWithFolders, type Folder, type Root } from '@tmcw/togeojson'
import type { Feature, Geometry, MultiPolygon, Polygon } from 'geojson'

// A KMZ is an untrusted ZIP holding untrusted XML. Limits below are enforced while inflating
// (not from the sizes the archive claims about itself), and XML with a DTD is rejected outright,
// which closes XXE and entity-expansion ("billion laughs") attacks before any parser runs.
export const LIMITS = {
  uploadBytes: 20 * 1024 * 1024,
  kmlBytes: 60 * 1024 * 1024,
  zipEntries: 200,
  features: 5000,
  vertices: 1_500_000,
}

export class UploadError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

export type BoundaryFeature = Feature<Polygon | MultiPolygon, Record<string, string | number>>

export function extractKml(bytes: Uint8Array, filename: string): string {
  if (bytes.byteLength > LIMITS.uploadBytes) throw new UploadError('too_large', 'File is larger than 20 MB')
  const lower = filename.toLowerCase()
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  if (!isZip) {
    if (!lower.endsWith('.kml')) throw new UploadError('bad_format', 'Expected a .kmz (zip) or .kml file')
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  }

  const kmls = new Map<string, Uint8Array[]>()
  let entries = 0
  let inflated = 0
  let failure: UploadError | null = null
  const unzip = new Unzip(file => {
    entries++
    if (entries > LIMITS.zipEntries) failure ??= new UploadError('zip_entries', 'Archive has too many entries')
    // names are only compared, never used as paths, so zip-slip ("../../x") has nothing to escape into
    if (failure || !file.name.toLowerCase().endsWith('.kml')) return
    const chunks: Uint8Array[] = []
    kmls.set(file.name, chunks)
    file.ondata = (err, chunk) => {
      if (err) { failure ??= new UploadError('zip_corrupt', 'Archive is corrupt'); return }
      inflated += chunk.byteLength
      if (inflated > LIMITS.kmlBytes) {
        failure ??= new UploadError('zip_bomb', 'Archive inflates beyond 60 MB')
        file.terminate()
        return
      }
      chunks.push(chunk)
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  unzip.register(UnzipPassThrough)
  // feed in slices so a bomb is caught early instead of after one giant push
  const step = 64 * 1024
  for (let i = 0; i < bytes.byteLength && !failure; i += step) {
    unzip.push(bytes.subarray(i, i + step), i + step >= bytes.byteLength)
  }
  if (failure) throw failure

  const name = kmls.has('doc.kml') ? 'doc.kml' : [...kmls.keys()][0]
  if (!name) throw new UploadError('no_kml', 'No .kml document inside the KMZ')
  const parts = kmls.get(name)!
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.byteLength }
  return new TextDecoder('utf-8', { fatal: false }).decode(out)
}

const PROP_KEY = /^[\p{L}\p{N} _.\-]{1,40}$/u
const DROP = new Set(['styleUrl', 'styleHash', 'styleMapHash', 'stroke', 'stroke-opacity', 'stroke-width', 'fill', 'fill-opacity', 'visibility', 'icon'])

function cleanProps(p: Record<string, unknown> | null, folder: string | null) {
  const out: Record<string, string | number> = {}
  let n = 0
  for (const [k, v] of Object.entries(p ?? {})) {
    if (DROP.has(k) || !PROP_KEY.test(k) || n >= 20) continue
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'string') out[k] = v.slice(0, 200)
    else continue
    n++
  }
  if (folder) out.folder = folder.slice(0, 200)
  return out
}

function polygonsOf(g: Geometry | null): Polygon[] {
  if (!g) return []
  if (g.type === 'Polygon') return [g]
  if (g.type === 'MultiPolygon') return g.coordinates.map(coordinates => ({ type: 'Polygon', coordinates }))
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(polygonsOf)
  return []
}

export function parseKml(text: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new UploadError('dtd_rejected', 'KML with a DTD/entities is not accepted')
  const errors: string[] = []
  const doc = new DOMParser({
    onError: (level, msg) => { if (level === 'fatalError') errors.push(msg) },
  }).parseFromString(text, 'text/xml')
  if (errors.length || !doc?.documentElement) throw new UploadError('bad_xml', 'KML is not well-formed XML')

  const tree: Root = kmlWithFolders(doc as unknown as Document)
  const features: BoundaryFeature[] = []
  let skipped = 0
  let vertices = 0

  const walk = (nodes: Root['children'], folder: string | null) => {
    for (const node of nodes) {
      if (node.type === 'folder') {
        const f = node as Folder
        walk(f.children, (f.meta?.name as string | undefined) ?? folder)
        continue
      }
      const polys = polygonsOf(node.geometry as Geometry | null)
      if (!polys.length) { skipped++; continue }
      for (const poly of polys) {
        vertices += poly.coordinates.reduce((n, ring) => n + ring.length, 0)
        if (vertices > LIMITS.vertices) throw new UploadError('too_complex', 'More than 1.5M vertices')
        if (features.length >= LIMITS.features) throw new UploadError('too_many', 'More than 5,000 polygons')
        const props = cleanProps(node.properties as Record<string, unknown>, folder)
        const name = String(props.name ?? `Polygon ${features.length + 1}`)
        features.push({
          type: 'Feature',
          properties: { ...props, name: polys.length > 1 ? `${name} (part ${polys.indexOf(poly) + 1})` : name },
          geometry: poly,
        })
      }
    }
  }
  walk(tree.children, null)
  if (!features.length) throw new UploadError('no_polygons', 'The KML has no polygons')
  return { features, skipped, vertices }
}
