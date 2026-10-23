'use client'
import { useMemo, useState } from 'react'
import { Send } from 'lucide-react'
import type { Geometry } from 'geojson'
import { Map, type Layer } from '@/components/Map'
import { ACTION, Badge, RECO } from '@/components/Badge'
import { fmtInt, fmtPct, months } from '@/lib/format'

type Col = { key: string; label: string; kind: 'num' | 'pct' | 'text' | 'bool' }
type Answer = {
  entity: string; understood: string; unsupported: string; filters: { field: string; op: string; value: string }[]; dropped: string[]
  sort: { field: string; dir: string }; columns: Col[]; rows: (Record<string, string | number | null> & { geom?: Geometry })[]; model: string
}

const EXAMPLES = [
  'Which Bekasi areas are below 60% of plan and older than a year?',
  'Top 15 uncovered cells in Jakarta Selatan that pay back within 20 months',
  'Area partner revenue-share dengan churn di atas 2,5%',
  'Where should we offer HiFi Air with at least 2,000 home-passes?',
  'Areas launched in 2024 that already paid back',
]
const OP: Record<string, string> = { eq: '=', neq: '≠', lt: '<', lte: '≤', gt: '>', gte: '≥' }

export function AskView() {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [a, setA] = useState<Answer | null>(null)

  async function ask(text: string) {
    setQ(text); setBusy(true); setErr(null)
    const r = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: text }) })
    const j = await r.json()
    if (r.ok) setA(j); else { setErr(j.error ?? 'Failed'); setA(null) }
    setBusy(false)
  }

  const layers: Layer[] = useMemo(() => !a ? [] : [{
    id: 'r',
    shapes: a.rows.filter(r => r.geom).map((r, i) => ({
      id: String(r.code ?? r.h3 ?? i), geom: r.geom as Geometry,
      cls: a.entity === 'areas' ? `p-${r.action}` : `p-seq-${Math.min(4, Math.floor(Number(r.score ?? 0) / 20))}`,
      fillOpacity: 0.5, weight: 1, tip: String(r.code ?? r.h3),
    })),
  }], [a])

  const cell = (c: Col, v: string | number | null) => {
    if (v == null) return c.key === 'payback' ? 'never' : '-'
    if (c.key === 'action') return <Badge tone={ACTION[String(v)]?.tone ?? 'neutral'}>{ACTION[String(v)]?.label ?? v}</Badge>
    if (c.key === 'reco') return <Badge tone={RECO[String(v)]?.tone ?? 'neutral'}>{RECO[String(v)]?.label ?? v}</Badge>
    if (c.key === 'payback') return months(Number(v))
    if (c.kind === 'pct') return fmtPct(Number(v))
    if (c.key === 'age') return `${v} months`
    if (c.kind === 'num') return c.key === 'score' ? Number(v).toFixed(0) : fmtInt(Number(v))
    return String(v)
  }

  return (
    <>
      <section className="card card-pad" style={{ marginBottom: 16 }}>
        <form className="row" onSubmit={e => { e.preventDefault(); if (q.trim()) ask(q.trim()) }}>
          <input className="input" value={q} onChange={e => setQ(e.target.value)} maxLength={400} placeholder="e.g. Which Bekasi areas are below 60% of plan and older than a year?" style={{ flex: 1, minWidth: 240, fontSize: 14, padding: '12px 12px' }} aria-label="Question" />
          <button className="btn btn-primary" disabled={busy || q.trim().length < 3}><Send size={14} /> {busy ? 'Thinking…' : 'Ask'}</button>
        </form>
        <div className="row" style={{ marginTop: 12 }}>
          {EXAMPLES.map(x => <button key={x} className="btn btn-sm" onClick={() => ask(x)} disabled={busy}>{x}</button>)}
        </div>
        {err && <p role="alert" style={{ color: 'var(--crit)', marginTop: 12, fontWeight: 600 }}>{err}</p>}
      </section>

      {a && (
        <>
          <section className="card card-pad" style={{ marginBottom: 16 }}>
            <div className="row between">
              <div><div className="facts-l">Understood as</div><div className="strong">{a.understood}</div></div>
              <span className="small muted">by {a.model}</span>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <Badge tone="brand">{a.entity === 'areas' ? 'Live areas' : 'Neighbourhoods'}</Badge>
              {a.filters.map((f, i) => <span key={i} className="badge b-neutral mono">{f.field} {OP[f.op] ?? f.op} {f.value}</span>)}
              <span className="badge b-low mono">sorted by {a.sort.field}, {a.sort.dir === 'asc' ? 'lowest first' : 'highest first'}</span>
              {a.dropped.length > 0 && <span className="badge b-warn">ignored: {a.dropped.join(', ')}</span>}
            </div>
            {a.unsupported && <div className="note" style={{ marginTop: 12 }}>Could not answer this part: {a.unsupported}</div>}
          </section>
          <div className="cols-even">
            <section className="card">
              <div className="card-head"><div><h2 className="card-title">{a.rows.length} result{a.rows.length === 1 ? '' : 's'}</h2></div></div>
              <div className="table-wrap" style={{ maxHeight: 560, marginTop: 12 }}>
                <table className="data">
                  <thead><tr>{a.columns.map(c => <th key={c.key} className={c.kind === 'num' || c.kind === 'pct' ? 'num' : undefined}>{c.label}</th>)}</tr></thead>
                  <tbody>
                    {a.rows.map((r, i) => <tr key={i}>{a.columns.map(c => <td key={c.key} className={c.kind === 'num' || c.kind === 'pct' ? 'num' : c.key === 'code' || c.key === 'h3' ? 'mono small' : undefined} style={{ whiteSpace: 'nowrap' }}>{cell(c, r[c.key] as never)}</td>)}</tr>)}
                    {a.rows.length === 0 && <tr><td colSpan={a.columns.length} className="muted">Nothing matches. Try a wider question.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="card">
              <div className="card-head"><div><h2 className="card-title">On the map</h2></div></div>
              <div style={{ marginTop: 12 }}>{layers[0]?.shapes.length ? <Map layers={layers} height={480} fitKey={a.understood} /> : <div className="card-pad muted">Nothing to map.</div>}</div>
            </section>
          </div>
        </>
      )}
    </>
  )
}
