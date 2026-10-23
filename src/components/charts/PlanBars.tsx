'use client'
import { useState } from 'react'
import { fmtInt, fmtPct, rp } from '@/lib/format'

const FORMATS = { pct: (v: number) => fmtPct(v), int: (v: number) => fmtInt(v), rp: (v: number) => rp(v) }

export type PlanRow = { key: string; label: React.ReactNode; actual: number; plan: number; color: string; detail?: string }

// Horizontal bars (actual) with a tick for the plan value; value at the bar tip; hover for detail.
export function PlanBars({ rows, unit, max }: { rows: PlanRow[]; unit: keyof typeof FORMATS; max?: number }) {
  const format = FORMATS[unit]
  const [hover, setHover] = useState<string | null>(null)
  const top = max ?? Math.max(...rows.flatMap(r => [r.actual, r.plan])) * 1.15
  return (
    <div className="stack" style={{ marginTop: 4 }}>
      {rows.map(r => (
        <div key={r.key} onPointerEnter={() => setHover(r.key)} onPointerLeave={() => setHover(null)} tabIndex={0} onFocus={() => setHover(r.key)} onBlur={() => setHover(null)}>
          <div className="row between small" style={{ marginBottom: 4 }}>
            <span className="strong">{r.label}</span>
            <span>{hover === r.key && r.detail ? <span className="muted">{r.detail}</span> : <><span className="strong">{format(r.actual)}</span> <span className="muted">vs plan {format(r.plan)}</span></>}</span>
          </div>
          <div style={{ position: 'relative', height: 16 }}>
            <div style={{ position: 'absolute', inset: '3px 0', background: 'var(--panel-alt)', borderRadius: 4 }} />
            <div style={{ position: 'absolute', left: 0, top: 3, bottom: 3, width: `${(r.actual / top) * 100}%`, background: r.color, borderRadius: '0 4px 4px 0', opacity: hover && hover !== r.key ? 0.55 : 1 }} />
            <div title={`Plan ${format(r.plan)}`} style={{ position: 'absolute', left: `calc(${(r.plan / top) * 100}% - 1px)`, top: 0, bottom: 0, width: 2, background: 'var(--ink)', borderRadius: 1 }} />
          </div>
        </div>
      ))}
      <div className="legend" style={{ padding: 0 }}>
        <span className="k"><span className="sw" style={{ background: 'var(--chart-neutral)' }} /> Actual (bar colour = partner)</span>
        <span className="k"><span style={{ width: 2, height: 12, background: 'var(--ink)' }} /> Business-plan target</span>
      </div>
    </div>
  )
}
