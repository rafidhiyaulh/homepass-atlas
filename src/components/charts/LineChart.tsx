'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { scaleLinear } from 'd3-scale'
import { line } from 'd3-shape'

export type Series = { key: string; label: string; color: string; points: { x: number; y: number }[]; dashed?: boolean; emphasis?: boolean }

// One y-axis, 2px lines, hairline grid, legend + end label on emphasised series only,
// crosshair tooltip listing every series at the hovered x.
export function LineChart({
  series, height = 300, xLabel, yFormat = (v: number) => String(v), xFormat = (v: number) => String(v),
}: {
  series: Series[]; height?: number; xLabel?: string; yFormat?: (v: number) => string; xFormat?: (v: number) => string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [hx, setHx] = useState<number | null>(null)
  const [w, setW] = useState(720)
  const m = { t: 12, r: 64, b: 34, l: 48 }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(320, el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { x, y, xs, yTicks } = useMemo(() => {
    const all = series.flatMap(s => s.points)
    const xMax = Math.max(1, ...all.map(p => p.x))
    const yMax = Math.max(0.01, ...all.map(p => p.y)) * 1.08
    const x = scaleLinear().domain([0, xMax]).range([m.l, w - m.r])
    const y = scaleLinear().domain([0, yMax]).range([height - m.b, m.t]).nice(5)
    const xs = [...new Set(all.map(p => p.x))].sort((a, b) => a - b)
    return { x, y, xs, yTicks: y.ticks(5) }
  }, [series, w, height, m.l, m.r, m.b, m.t])

  const path = line<{ x: number; y: number }>().x(p => x(p.x)).y(p => y(p.y))

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * w
    const v = x.invert(px)
    const nearest = xs.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), xs[0])
    setHx(nearest)
  }

  const tipRows = hx == null ? [] : series.map(s => ({ s, p: s.points.find(p => p.x === hx) })).filter(r => r.p)
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} onPointerMove={onMove} onPointerLeave={() => setHx(null)} role="img" aria-label={series.map(s => s.label).join(', ')} style={{ display: 'block', touchAction: 'none' }}>
        {yTicks.map(t => (
          <g key={t}>
            <line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)">{yFormat(t)}</text>
          </g>
        ))}
        {x.ticks(Math.max(3, Math.floor(w / 90))).map(t => (
          <text key={t} x={x(t)} y={height - m.b + 16} textAnchor="middle" fontSize={11} fill="var(--muted)">{xFormat(t)}</text>
        ))}
        {xLabel && <text x={(m.l + w - m.r) / 2} y={height - 3} textAnchor="middle" fontSize={11} fill="var(--muted)">{xLabel}</text>}
        <line x1={m.l} x2={w - m.r} y1={y(0)} y2={y(0)} stroke="var(--rule2)" />
        {series.map(s => (
          <path key={s.key} d={path(s.points) ?? ''} fill="none" stroke={s.color} strokeWidth={s.emphasis ? 2.5 : 2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '6 4' : undefined} opacity={hx == null || s.emphasis || s.dashed ? 1 : 0.85} />
        ))}
        {series.filter(s => s.emphasis || s.dashed).map(s => {
          const last = s.points[s.points.length - 1]
          if (!last) return null
          return (
            <g key={s.key + 'end'}>
              <circle cx={x(last.x)} cy={y(last.y)} r={4} fill={s.color} stroke="var(--panel)" strokeWidth={2} />
              <text x={x(last.x) + 8} y={y(last.y)} dy="0.32em" fontSize={11} fill="var(--ink2)" fontWeight={650}>{s.label}</text>
            </g>
          )
        })}
        {hx != null && (
          <g>
            <line x1={x(hx)} x2={x(hx)} y1={m.t} y2={height - m.b} stroke="var(--ink2)" strokeWidth={1} opacity={0.5} />
            {tipRows.map(({ s, p }) => <circle key={s.key} cx={x(hx)} cy={y(p!.y)} r={4} fill={s.color} stroke="var(--panel)" strokeWidth={2} />)}
          </g>
        )}
      </svg>
      {hx != null && tipRows.length > 0 && (
        <div className="chart-tip" style={{ left: `min(calc(${(x(hx) / w) * 100}% + 12px), calc(100% - 190px))`, top: 8 }}>
          <div className="strong" style={{ marginBottom: 4 }}>{xLabel ? `${xLabel}: ` : ''}{xFormat(hx)}</div>
          {tipRows.sort((a, b) => b.p!.y - a.p!.y).map(({ s, p }) => (
            <div key={s.key} className="row between" style={{ gap: 12 }}>
              <span className="row" style={{ gap: 8 }}><span style={{ width: 10, height: s.dashed ? 2 : 3, background: s.color, borderRadius: 2 }} />{s.label}</span>
              <span className="strong">{yFormat(p!.y)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="legend" style={{ padding: '8px 0 0 ' + m.l + 'px' }}>
        {series.map(s => (
          <span key={s.key} className="k"><span style={{ width: 14, height: 0, borderTop: `${s.emphasis ? 3 : 2}px ${s.dashed ? 'dashed' : 'solid'} ${s.color}` }} />{s.label}</span>
        ))}
      </div>
    </div>
  )
}
