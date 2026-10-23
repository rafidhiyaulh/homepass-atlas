'use client'
import { useEffect, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { Geometry } from 'geojson'
import { Map, type Layer } from '@/components/Map'
import { ACTION, Badge, PartnerDot } from '@/components/Badge'
import { LineChart } from '@/components/charts/LineChart'
import { fmtInt, fmtPct, months, rp } from '@/lib/format'

type Area = {
  id: number; code: string; name: string; partner_id: number; partner_code: string; kota: string; age: number; homepass: number; subs: number
  takeup: number; bp_takeup: number; vs_plan: number; margin_m: number; churn_m: number; payback_proj: number | null; action: string; reasons: string[]; geom: Geometry
}
type Detail = {
  facts: Record<string, string | number | null | string[]>
  diagnosis: { verdict: string; drivers: { driver: string; evidence: string; lever: string }[] }
  series: { age: number; subs: number; revenue: number; partner_cost: number }[]
}

const REASON: Record<string, string> = {
  takeup_far_below_plan: 'Take-up < 50% of plan', takeup_below_plan: 'Take-up < 85% of plan', no_payback_at_current_margin: 'No payback at current margin',
  payback_over_5y: 'Payback > 5 years', payback_over_4y: 'Payback > 4 years', high_churn: 'Churn > 2.5%/mo', negative_margin: 'Negative margin',
}
const ORDER = ['exit', 'optimize', 'maintain', 'ramping']

export function PortfolioView({ areas }: { areas: Area[] }) {
  const [tab, setTab] = useState('exit')
  const [sel, setSel] = useState<number | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [note, setNote] = useState<{ text: string | null; model?: string | null; grounded?: boolean; reason?: string } | null>(null)
  const [loadingNote, setLoadingNote] = useState(false)

  const counts = useMemo(() => Object.fromEntries(ORDER.map(a => [a, areas.filter(x => x.action === a)])), [areas])
  const rows = counts[tab] ?? []
  const layers: Layer[] = useMemo(() => [{
    id: 'a', shapes: areas.map(a => ({ id: a.id, geom: a.geom, cls: `p-${a.action}`, fillOpacity: a.action === tab ? 0.55 : 0.12, weight: a.action === tab ? 1.4 : 0.6, tip: `${a.code} · ${ACTION[a.action].label} · ${fmtPct(a.vs_plan, 0)} of plan` })),
  }], [areas, tab])

  const select = (id: number | null) => { setSel(id); setDetail(null); setNote(null) }
  useEffect(() => {
    if (sel == null) return
    let alive = true
    fetch(`/api/portfolio/${sel}`).then(r => r.json()).then(j => { if (alive) setDetail(j) })
    return () => { alive = false }
  }, [sel])

  async function writeNote() {
    if (sel == null) return
    setLoadingNote(true)
    const r = await fetch(`/api/portfolio/${sel}/narrative`, { method: 'POST' })
    const j = await r.json()
    setNote(r.ok ? j : { text: null, reason: j.error })
    setLoadingNote(false)
  }

  const a = areas.find(x => x.id === sel)
  return (
    <>
      <div className="kpis">
        {ORDER.map(k => (
          <button key={k} onClick={() => { setTab(k); select(null) }} className="kpi" style={{ textAlign: 'left', cursor: 'pointer', borderTopColor: `var(--chart-${k === 'maintain' ? 'good' : k === 'optimize' ? 'warn' : k === 'exit' ? 'bad' : 'neutral'})`, outline: tab === k ? '2px solid var(--brand)' : undefined }}>
            <div className="label"><span aria-hidden>{ACTION[k].icon}</span> {ACTION[k].label}</div>
            <div className="value">{counts[k].length}</div>
            <div className="sub">{fmtInt(counts[k].reduce((s, x) => s + x.homepass, 0))} HP · {rp(counts[k].reduce((s, x) => s + x.margin_m, 0))}/mo margin</div>
          </button>
        ))}
      </div>

      <div className="cols-2">
        <section className="card">
          <div className="card-head"><div><h2 className="card-title">{ACTION[tab].label} · {rows.length} areas</h2><div className="card-sub">Sorted by gap to plan. Click an area for the diagnosis.</div></div></div>
          <Map layers={layers} selected={sel} onSelect={(_, id) => select(Number(id))} height={340} fitKey="portfolio" />
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table className="data">
              <thead><tr><th>Area</th><th>Partner</th><th className="num">Age</th><th className="num">Take-up</th><th className="num">vs plan</th><th className="num">Payback</th><th>Why</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className={`clickable${sel === r.id ? ' is-sel' : ''}`} onClick={() => select(r.id)}>
                    <td><span className="mono small">{r.code}</span><div className="small muted">{r.kota}</div></td>
                    <td><PartnerDot id={r.partner_id} code={r.partner_code} /></td>
                    <td className="num">{r.age} mo</td>
                    <td className="num">{fmtPct(r.takeup)}</td>
                    <td className="num strong">{fmtPct(r.vs_plan, 0)}</td>
                    <td className="num">{months(r.payback_proj)}</td>
                    <td className="small">{r.reasons.map(x => REASON[x] ?? x).join(' · ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card card-pad" style={{ alignSelf: 'start', position: 'sticky', top: 70 }}>
          {!a && <div className="muted">Select an area on the map or in the table.</div>}
          {a && (
            <div className="stack">
              <div className="row between">
                <div><div className="mono small muted">{a.code}</div><div className="strong" style={{ fontSize: 15 }}>{a.name}</div></div>
                <Badge tone={ACTION[a.action].tone}><span aria-hidden>{ACTION[a.action].icon}</span> {ACTION[a.action].label}</Badge>
              </div>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                <Mini k="Home-passes" v={fmtInt(a.homepass)} />
                <Mini k="Subscribers" v={fmtInt(a.subs)} />
                <Mini k="Age" v={`${a.age} mo`} />
                <Mini k="Take-up" v={fmtPct(a.takeup)} />
                <Mini k="Plan now" v={fmtPct(a.bp_takeup)} />
                <Mini k="Margin/mo" v={rp(a.margin_m)} />
              </div>
              {detail ? (
                <>
                  <LineChart height={170} xLabel="Months since RFS" xFormat={v => `M${v}`} yFormat={v => fmtPct(v, 0)}
                    series={[
                      { key: 'a', label: 'Take-up', color: 'var(--brand)', emphasis: true, points: detail.series.map(s => ({ x: s.age, y: s.subs / a.homepass })) },
                      { key: 'p', label: 'Plan', color: 'var(--ink)', dashed: true, points: detail.series.map(s => ({ x: s.age, y: 0.15 * (1 - Math.exp(-(Math.min(s.age, 48) + 0.5) / 7)) / (1 - Math.exp(-12 / 7)) })) },
                    ]} />
                  <div className="strong">{detail.diagnosis.verdict}</div>
                  <div className="small strong muted" style={{ textTransform: 'uppercase', letterSpacing: '.12em' }}>Likely drivers → levers</div>
                  {detail.diagnosis.drivers.map((d, i) => (
                    <div key={i} style={{ borderLeft: '3px solid var(--brand)', paddingLeft: 10 }}>
                      <div className="strong">{d.driver}</div>
                      <div className="small muted">{d.evidence}</div>
                      <div className="small" style={{ marginTop: 2 }}>→ {d.lever}</div>
                    </div>
                  ))}
                  <div className="hr" />
                  <button className="btn" onClick={writeNote} disabled={loadingNote}><Sparkles size={14} /> {loadingNote ? 'Writing…' : 'Draft a note for management (Gemini)'}</button>
                  {note && (note.text
                    ? <div className="note"><div>{note.text}</div><div className="small muted" style={{ marginTop: 6 }}>{note.model} · every number checked against the area facts</div></div>
                    : <div className="note">No AI note: {note.reason === 'llm_unavailable' ? 'model unavailable' : note.grounded === false ? 'the draft contained numbers not in the facts, so it was discarded' : note.reason}. The deterministic diagnosis above stands on its own.</div>)}
                </>
              ) : <div className="skeleton" style={{ height: 200 }} />}
            </div>
          )}
        </section>
      </div>
    </>
  )
}

function Mini({ k, v }: { k: string; v: string }) {
  return <div style={{ background: 'var(--panel-alt)', borderRadius: 6, padding: '5px 8px' }}><div className="small muted">{k}</div><div className="strong">{v}</div></div>
}
