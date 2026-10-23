'use client'
import { useEffect, useMemo, useState } from 'react'
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
  takeup_far_below_plan: 'Sales under half of plan', takeup_below_plan: 'Sales under 85% of plan', no_payback_at_current_margin: 'Never earns back at today\'s profit',
  payback_over_5y: 'Earns back after 5+ years', payback_over_4y: 'Earns back after 4+ years', high_churn: 'Many cancellations', negative_margin: 'Losing money',
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
    id: 'a', shapes: areas.map(a => ({ id: a.id, geom: a.geom, cls: `p-${a.action}`, fillOpacity: a.action === tab ? 0.55 : 0.12, weight: a.action === tab ? 1.4 : 0.6, tip: [a.code, ACTION[a.action].label, `${fmtPct(a.vs_plan, 0)} of plan`] })),
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
          <button key={k} onClick={() => { setTab(k); select(null) }} className={`kpi${tab === k ? ' on' : ''}`} aria-pressed={tab === k}>
            <div className="label" style={{ display: 'flex', alignItems: 'center' }}><span className="key" style={{ background: `var(--chart-${k === 'maintain' ? 'good' : k === 'optimize' ? 'warn' : k === 'exit' ? 'bad' : 'neutral'})` }} aria-hidden />{ACTION[k].label}</div>
            <div className="value">{counts[k].length}</div>
            <div className="sub">{fmtInt(counts[k].reduce((s, x) => s + x.homepass, 0))} homes, {rp(counts[k].reduce((s, x) => s + x.margin_m, 0))} profit a month</div>
          </button>
        ))}
      </div>

      <div className="cols-2">
        <section className="card">
          <div className="card-head"><div><h2 className="card-title">{ACTION[tab].label}: {rows.length} areas</h2><div className="card-sub">Furthest behind plan first. Click an area for details.</div></div></div>
          <Map layers={layers} selected={sel} onSelect={(_, id) => select(Number(id))} height={340} fitKey="portfolio" />
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table className="data">
              <thead><tr><th>Area</th><th>Partner</th><th className="num">Live for</th><th className="num">Take-up</th><th className="num">Of plan</th><th className="num">Earns back</th><th>Why</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className={`clickable${sel === r.id ? ' is-sel' : ''}`} onClick={() => select(r.id)}>
                    <td><span className="mono small">{r.code}</span><div className="small muted">{r.kota}</div></td>
                    <td><PartnerDot id={r.partner_id} code={r.partner_code} /></td>
                    <td className="num">{r.age} months</td>
                    <td className="num">{fmtPct(r.takeup)}</td>
                    <td className="num strong">{fmtPct(r.vs_plan, 0)}</td>
                    <td className="num">{months(r.payback_proj)}</td>
                    <td className="small">{r.reasons.length ? <ul className="list-plain">{r.reasons.map(x => <li key={x}>{REASON[x] ?? x}</li>)}</ul> : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card card-pad" style={{ alignSelf: 'start', position: 'sticky', top: 70 }}>
          {!a && <div className="muted">Click an area on the map or in the table.</div>}
          {a && (
            <div className="stack">
              <div className="row between">
                <div><div className="mono small muted">{a.code}</div><div className="strong" style={{ fontSize: 15 }}>{a.name}</div></div>
                <Badge tone={ACTION[a.action].tone}><span aria-hidden>{ACTION[a.action].icon}</span> {ACTION[a.action].label}</Badge>
              </div>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <Mini k="Homes" v={fmtInt(a.homepass)} />
                <Mini k="Customers" v={fmtInt(a.subs)} />
                <Mini k="Live for" v={`${a.age} months`} />
                <Mini k="Take-up" v={fmtPct(a.takeup)} />
                <Mini k="Plan expected" v={fmtPct(a.bp_takeup)} />
                <Mini k="Profit/month" v={rp(a.margin_m)} />
              </div>
              {detail ? (
                <>
                  <LineChart height={170} xLabel="Months since launch" xFormat={v => `M${v}`} yFormat={v => fmtPct(v, 0)}
                    series={[
                      { key: 'a', label: 'Take-up', color: 'var(--brand)', emphasis: true, points: detail.series.map(s => ({ x: s.age, y: s.subs / a.homepass })) },
                      { key: 'p', label: 'Plan', color: 'var(--ink)', dashed: true, points: detail.series.map(s => ({ x: s.age, y: 0.15 * (1 - Math.exp(-(Math.min(s.age, 48) + 0.5) / 7)) / (1 - Math.exp(-12 / 7)) })) },
                    ]} />
                  <div className="strong">{detail.diagnosis.verdict}</div>
                  <div className="small strong muted" style={{ textTransform: 'uppercase', letterSpacing: '.12em' }}>Likely cause and what to do</div>
                  {detail.diagnosis.drivers.map((d, i) => (
                    <div key={i} style={{ background: 'var(--panel-alt)', borderRadius: 6, padding: '8px 12px' }}>
                      <div className="strong">{d.driver}</div>
                      <div className="small muted">{d.evidence}</div>
                      <div className="small" style={{ marginTop: 2 }}>→ {d.lever}</div>
                    </div>
                  ))}
                  <div className="hr" />
                  <button className="btn" onClick={writeNote} disabled={loadingNote}>{loadingNote ? 'Writing…' : 'Write a summary for management (AI)'}</button>
                  {note && (note.text
                    ? <div className="note"><div>{note.text}</div><div className="small muted" style={{ marginTop: 8 }}>Written by {note.model}. Every number was checked against the data.</div></div>
                    : <div className="note">No AI summary: {note.reason === 'llm_unavailable' ? 'the AI is unavailable right now' : note.grounded === false ? 'it used numbers not in the data, so it was thrown away' : note.reason}. The analysis above still holds.</div>)}
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
  return <div style={{ background: 'var(--panel-alt)', borderRadius: 6, padding: '4px 8px' }}><div className="small muted">{k}</div><div className="strong">{v}</div></div>
}
