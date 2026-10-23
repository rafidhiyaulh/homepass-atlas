'use client'
import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo } from 'react'
import { MapContainer, Polygon, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { LatLngBoundsExpression, LatLngExpression } from 'leaflet'
import type { Geometry } from 'geojson'

export type Shape = {
  id: string | number
  geom: Geometry
  cls: string                 // colour class (see globals.css .p-*)
  fillOpacity?: number
  weight?: number
  dash?: string
  tip?: string
}
export type Layer = { id: string; shapes: Shape[]; interactive?: boolean }

type Ring = LatLngExpression[]
function toPositions(g: Geometry): Ring[][] {
  const ring = (r: number[][]): Ring => r.map(([x, y]) => [y, x] as LatLngExpression)
  if (g.type === 'Polygon') return [g.coordinates.map(ring)]
  if (g.type === 'MultiPolygon') return g.coordinates.map(p => p.map(ring))
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(toPositions)
  return []
}

function Fit({ bounds, fitKey }: { bounds: LatLngBoundsExpression | null; fitKey: string }) {
  const map = useMap()
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])
  return null
}

export default function AtlasMap({
  layers, selected, onSelect, height = 520, fitKey = 'all', fitLayer,
}: {
  layers: Layer[]
  selected?: string | number | null
  onSelect?: (layer: string, id: string | number) => void
  height?: number
  fitKey?: string
  fitLayer?: string
}) {
  const prepared = useMemo(
    () => layers.map(l => ({ ...l, shapes: l.shapes.map(s => ({ ...s, pos: toPositions(s.geom) })) })),
    [layers],
  )
  const bounds = useMemo(() => {
    let minLat = 90, minLng = 180, maxLat = -90, maxLng = -180
    for (const l of prepared) {
      if (fitLayer && l.id !== fitLayer) continue
      for (const s of l.shapes) for (const p of s.pos) for (const r of p) for (const ll of r as [number, number][]) {
        minLat = Math.min(minLat, ll[0]); maxLat = Math.max(maxLat, ll[0]); minLng = Math.min(minLng, ll[1]); maxLng = Math.max(maxLng, ll[1])
      }
    }
    return minLat <= maxLat ? ([[minLat, minLng], [maxLat, maxLng]] as LatLngBoundsExpression) : null
  }, [prepared, fitLayer])

  return (
    <MapContainer center={[-6.23, 106.83]} zoom={11} style={{ height }} className="map" scrollWheelZoom preferCanvas={false}>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · buildings: Overture Maps'
        maxZoom={19}
      />
      <Fit bounds={bounds} fitKey={fitKey} />
      {prepared.map(l =>
        l.shapes.map(s => {
          const sel = selected != null && String(selected) === String(s.id) && l.interactive !== false
          // Leaflet applies className only at creation, so the class is part of the key
          return s.pos.map((p, i) => (
            <Polygon
              key={`${l.id}:${s.id}:${i}:${s.cls}:${sel ? 1 : 0}`}
              positions={p}
              className={`${s.cls}${sel ? ' p-sel' : ''}`}
              pathOptions={{ weight: sel ? 3 : (s.weight ?? 1.4), fillOpacity: s.fillOpacity ?? 0.28, opacity: 0.95, dashArray: s.dash }}
              interactive={l.interactive !== false}
              eventHandlers={onSelect && l.interactive !== false ? { click: () => onSelect(l.id, s.id) } : undefined}
            >
              {s.tip && i === 0 && <Tooltip sticky>{s.tip}</Tooltip>}
            </Polygon>
          ))
        }),
      )}
    </MapContainer>
  )
}
