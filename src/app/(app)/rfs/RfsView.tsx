'use client'
import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import type { Geometry } from 'geojson'
import { Map, type Layer } from '@/components/Map'
import { Badge, RECO } from '@/components/Badge'
import { Kpi } from '@/components/Kpi'
import { fmtInt, fmtPct, months } from '@/lib/format'
import { InfoTip, Term } from '@/components/Help'

// plain names for the model's inputs
const FEATURE: Record<string, string> = {
  homepass_log: 'Number of homes', avg_home_m2: 'House size', density: 'How built-up', mdu_share: 'Share of apartments',
  large_share: 'Industrial land', dist_cbd_km: 'Distance to city centre', competitors: 'Competing fiber brands',
}

type Driver = { f: string; label: string; v: number; x: number }
type Cell = {
  h3: string; kota: string; buildings: number; homepass_est: number; mdu_share: number; dist_cbd_km: number; competitors: number
  covered: boolean; p12: number; p24: number; drivers: { base: number; items: Driver[] }; score: number; reco: string; payback: number | null; geom: Geometry
}
type Model = { model: string; target: string; metrics: Record<string, number | string>; importance: { feature: string; label: string; gain: number }[]; notes: string }

const BAND = [20, 40, 60, 80]
const band = (s: number) => BAND.filter(b => s >= b).length
const KOTA_SHORT = (k: string) => k.replace('Kota ', '')

const fmtX = (d: Driver) =>
  d.f === 'homepass_log' ? `${fmtInt(Math.expm1(d.x))} HP` : d.f === 'avg_home_m2' ? `${fmtInt(d.x)} m²` : d.f === 'density' ? `${fmtInt(d.x)}/km²`
    : d.f === 'mdu_share' || d.f === 'large_share' ? fmtPct(d.x, 0) : d.f === 'dist_cbd_km' ? `${d.x.toFixed(1)} km` : String(d.x)

export function RfsView({ cells, model }: { cells: Cell[]; model: Model }) {
  const [reco, setReco] = useState<'build' | 'fwa' | 'hold' | 'all'>('build')
  const [kota, setKota] = useState('all')
  const [sel, setSel] = useState<string | null>(null)

  const kotas = useMemo(() => [...new Set(cells.map(c => c.kota))].sort(), [cells])
  const open = useMemo(() => cells.filter(c => !c.covered && (kota === 'all' || c.kota === kota)), [cells, kota])
  const shown = useMemo(() => open.filter(c => reco === 'all' || c.reco === reco).sort((a, b) => b.score - a.score), [open, reco])
  const shownSet = useMemo(() => new Set(shown.map(c => c.h3)), [shown])

  const layers: Layer[] = useMemo(() => [
    { id: 'covered', interactive: false, shapes: cells.filter(c => c.covered && (kota === 'all' || c.kota === kota)).map(c => ({ id: c.h3, geom: c.geom, cls: 'p-covered', fillOpacity: 0.18, weight: 0.4 })) },
    {
      id: 'open',
      shapes: open.map(c => ({
        id: c.h3, geom: c.geom, cls: `p-seq-${band(c.score)}`,
        fillOpacity: shownSet.has(c.h3) ? 0.62 : 0.12, weight: shownSet.has(c.h3) ? 0.6 : 0.2,
        tip: [KOTA_SHORT(c.kota), `Score ${c.score.toFixed(0)} of 100`, `${fmtInt(c.homepass_est)} homes`, `${fmtPct(c.p12)} expected to buy in year 1`, RECO[c.reco].label],
      })),
    },
  ], [cells, open, shownSet, kota])

  const s = cells.find(c => c.h3 === sel)
  const tot = {
    hp: shown.reduce((a, c) => a + c.homepass_est, 0),
    subs: shown.reduce((a, c) => a + c.homepass_est * c.p24, 0),
  }
  const m = model.metrics

  return (
    <>
      <div className="kpis">
        <Kpi label="Neighbourhoods shown" term="hex" value={fmtInt(shown.length)} sub={`${RECO[reco]?.label ?? 'All without fiber'}${kota !== 'all' ? `, ${KOTA_SHORT(kota)}` : ''}`} accent="var(--brand)" />
        <Kpi label="Homes in them" term="homepass" value={fmtInt(tot.hp)} sub="counted from real building outlines" accent="var(--ink)" />
        <Kpi label="Customers after 2 years" value={fmtInt(tot.subs)} sub={`${fmtPct(tot.subs / Math.max(1, tot.hp))} of those homes`} accent="var(--ink)" />
        <Kpi label="Prediction accuracy" help="Average gap between predicted and actual take-up, tested on areas the model never saw." value={`±${(Number(m.mae) * 100).toFixed(1)} pts`} sub={`${fmtPct(Number(m.mae_lift_vs_mean), 0)} better than guessing the average`} accent="var(--chart-good)" />
      </div>

      <section className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div><h2 className="card-title">Opportunity map</h2><div className="card-sub">Darker means more value over 5 years. Grey already has our fiber.</div></div>
          <div className="toolbar">
            <div className="seg" role="group" aria-label="Recommendation">
              {(['build', 'fwa', 'hold', 'all'] as const).map(r => (
                <button key={r} className={reco === r ? 'on' : ''} onClick={() => setReco(r)}>
                  {r === 'all' ? 'All' : RECO[r].label} ({open.filter(c => r === 'all' || c.reco === r).length})
                </button>
              ))}
            </div>
            <select className="select" value={kota} onChange={e => setKota(e.target.value)} aria-label="Kota">
              <option value="all">All cities</option>
              {kotas.map(k => <option key={k} value={k}>{KOTA_SHORT(k)}</option>)}
            </select>
            <a className="btn" href={`/api/rfs/export?reco=${reco}&kota=${encodeURIComponent(kota)}`}><Download size={14} /> KMZ for site survey</a>
          </div>
        </div>
        <div style={{ position: 'relative', marginTop: 12 }}>
          <Map layers={layers} selected={sel} onSelect={(l, id) => l === 'open' && setSel(String(id))} fitLayer="open" fitKey={kota} />
          {s && (
            <div className="card card-pad" style={{ position: 'absolute', top: 12, right: 12, width: 340, zIndex: 500, maxHeight: 490, overflowY: 'auto' }}>
              <div className="row between"><span className="strong">{KOTA_SHORT(s.kota)}</span><button className="btn btn-ghost btn-sm" onClick={() => setSel(null)} aria-label="Close">✕</button></div>
              <div className="row" style={{ margin: '6px 0' }}><Badge tone={RECO[s.reco].tone}>{RECO[s.reco].label}</Badge><span className="small muted">score {s.score.toFixed(0)} of 100</span></div>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 6, margin: '8px 0' }}>
                <Stat k="Homes" v={fmtInt(s.homepass_est)} />
                <Stat k="Buildings" v={fmtInt(s.buildings)} />
                <Stat k="Buy in year 1" v={fmtPct(s.p12)} />
                <Stat k="Buy in year 2" v={fmtPct(s.p24)} />
                <Stat k="Earns back in" v={months(s.payback)} />
                <Stat k="Competitors" v={String(s.competitors)} />
              </div>
              <div className="small strong" style={{ marginTop: 6 }}>What drives this prediction<InfoTip k="shap" /></div>
              <Drivers d={s.drivers} />
            </div>
          )}
        </div>
        <div className="legend">
          <span className="k">Value:</span>
          {['lowest', '', '', '', 'highest'].map((l, i) => <span key={i} className="k"><span className="sw" style={{ background: `var(--seq-${i})` }} />{l}</span>)}
          <span className="k"><span className="sw" style={{ background: 'var(--chart-neutral)', opacity: 0.5 }} /> Already has our fiber</span>
        </div>
      </section>

      <div className="cols-2">
        <section className="card">
          <div className="card-head"><div><h2 className="card-title">Best places first</h2><div className="card-sub">Top {Math.min(40, shown.length)} by value. Click a row to find it.</div></div></div>
          <div className="table-wrap" style={{ maxHeight: 560, marginTop: 10 }}>
            <table className="data">
              <thead><tr><th>#</th><th>City</th><th className="num">Homes</th><th className="num">Buy in year 1</th><th className="num">Customers yr 2</th><th className="num"><Term k="payback">Earns back</Term></th><th>Advice</th><th className="num">Score</th></tr></thead>
              <tbody>
                {shown.slice(0, 40).map((c, i) => (
                  <tr key={c.h3} className={`clickable${sel === c.h3 ? ' is-sel' : ''}`} onClick={() => setSel(c.h3)}>
                    <td className="mono small muted">{i + 1}</td>
                    <td>{KOTA_SHORT(c.kota)}</td>
                    <td className="num">{fmtInt(c.homepass_est)}</td>
                    <td className="num">{fmtPct(c.p12)}</td>
                    <td className="num">{fmtInt(c.homepass_est * c.p24)}</td>
                    <td className="num">{months(c.payback)}</td>
                    <td><Badge tone={RECO[c.reco].tone}>{RECO[c.reco].label}</Badge></td>
                    <td className="num strong">{c.score.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card card-pad">
          <h2 className="card-title">About the prediction</h2>
          <div className="small muted" style={{ marginTop: 2 }}>A model learns from areas already selling. It predicts year-one take-up for new places.</div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8, margin: '12px 0' }}>
            <Stat k="Learned from" v={`${m.n_train} neighbourhoods in ${m.n_areas} areas`} />
            <Stat k="Tested on" v="areas it never saw" />
            <Stat k="Average miss" v={`±${(Number(m.mae) * 100).toFixed(1)} points`} />
            <Stat k="Guessing the average" v={`±${(Number(m.mae_baseline) * 100).toFixed(1)} points`} />
          </div>
          <div className="small strong">What matters most</div>
          <div className="stack" style={{ marginTop: 8 }}>
            {model.importance.map(f => (
              <div key={f.feature}>
                <div className="row between small"><span>{FEATURE[f.feature] ?? f.label}</span><span className="strong">{fmtPct(f.gain, 0)}</span></div>
                <div className="bar-track"><div style={{ width: `${f.gain * 100}%`, height: '100%', background: 'var(--seq-3)', borderRadius: '0 3px 3px 0' }} /></div>
              </div>
            ))}
          </div>
          <div className="note" style={{ marginTop: 14 }}>
            <div className="strong">Money assumptions</div>
            <ul style={{ margin: '4px 0 0 18px' }}>
              <li>Customer pays Rp 255K a month.</li>
              <li>Partner fee is Rp 100K per customer.</li>
              <li>Building costs Rp 400K per home.</li>
              <li>Installing a customer costs Rp 650K.</li>
            </ul>
          </div>
        </section>
      </div>
    </>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ background: 'var(--panel-alt)', borderRadius: 6, padding: '6px 8px' }}>
      <div className="small muted">{k}</div>
      <div className="strong">{v}</div>
    </div>
  )
}

function Drivers({ d }: { d: { base: number; items: Driver[] } }) {
  const max = Math.max(...d.items.map(i => Math.abs(i.v)), 0.001)
  return (
    <div className="stack" style={{ marginTop: 8 }}>
      {d.items.map(i => (
        <div key={i.f}>
          <div className="row between small"><span>{FEATURE[i.f] ?? i.label} <span className="muted">({fmtX(i)})</span></span><span className="strong">{i.v >= 0 ? '+' : ''}{(i.v * 100).toFixed(1)} pts</span></div>
          <div style={{ display: 'flex', height: 8, marginTop: 2 }}>
            <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>{i.v < 0 && <div style={{ width: `${(-i.v / max) * 100}%`, background: 'var(--low)', borderRadius: '4px 0 0 4px' }} />}</div>
            <div style={{ width: 1, background: 'var(--rule2)' }} />
            <div style={{ flex: 1 }}>{i.v > 0 && <div style={{ width: `${(i.v / max) * 100}%`, height: '100%', background: 'var(--brand)', borderRadius: '0 4px 4px 0' }} />}</div>
          </div>
        </div>
      ))}
      <div className="legend" style={{ padding: 0 }}>
        <span className="k"><span className="sw" style={{ background: 'var(--brand)' }} /> pushes up</span>
        <span className="k"><span className="sw" style={{ background: 'var(--low)' }} /> pushes down</span>
        <span className="k muted">starting from {fmtPct(d.base)}</span>
      </div>
    </div>
  )
}
