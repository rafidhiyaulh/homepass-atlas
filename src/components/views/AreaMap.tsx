'use client'
import { useMemo, useState } from 'react'
import { Map, type Layer } from '@/components/Map'
import { ACTION } from '@/components/Badge'
import type { Geometry } from 'geojson'
import { fmtInt, fmtPct } from '@/lib/format'

export type AreaGeo = { id: number; code: string; partner_id: number; partner_code: string; action: string; takeup: number; homepass: number; geom: Geometry }

export function AreaMap({ areas, partners, height = 460 }: { areas: AreaGeo[]; partners: { id: number; code: string; name: string }[]; height?: number }) {
  const [by, setBy] = useState<'partner' | 'action'>('partner')
  const layers: Layer[] = useMemo(() => [{
    id: 'areas',
    shapes: areas.map(a => ({
      id: a.id, geom: a.geom, cls: by === 'partner' ? `p-partner-${a.partner_id}` : `p-${a.action}`, fillOpacity: 0.35, weight: 1,
      tip: `${a.code} · ${fmtInt(a.homepass)} HP · take-up ${fmtPct(a.takeup)} · ${ACTION[a.action]?.label ?? a.action}`,
    })),
  }], [areas, by])
  return (
    <>
      <div className="row between" style={{ padding: '10px 16px 8px' }}>
        <div className="seg" role="group" aria-label="Colour areas by">
          <button className={by === 'partner' ? 'on' : ''} onClick={() => setBy('partner')}>By partner</button>
          <button className={by === 'action' ? 'on' : ''} onClick={() => setBy('action')}>By portfolio action</button>
        </div>
        <span className="small muted">{areas.length} RFS areas</span>
      </div>
      <Map layers={layers} height={height} />
      <div className="legend">
        {by === 'partner'
          ? partners.map(p => <span key={p.id} className="k"><span className="sw" style={{ background: `var(--partner-${p.id})` }} /><span className="mono">{p.code}</span> {p.name}</span>)
          : ['maintain', 'optimize', 'exit', 'ramping'].map(k => <span key={k} className="k"><span className="sw" style={{ background: `var(--chart-${k === 'maintain' ? 'good' : k === 'optimize' ? 'warn' : k === 'exit' ? 'bad' : 'neutral'})` }} /><span aria-hidden>{ACTION[k].icon}</span> {ACTION[k].label}</span>)}
      </div>
    </>
  )
}
