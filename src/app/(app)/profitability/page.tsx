import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { Kpi } from '@/components/Kpi'
import { Card } from '@/components/Kpi'
import { PartnerDot, Badge } from '@/components/Badge'
import { CohortChart } from './CohortChart'
import { fmtInt, fmtPct, months, rp } from '@/lib/format'

export const metadata = { title: 'Profitability & cohorts' }

export default async function Page() {
  const me = await requireMe()
  const d = await asUser(me, async tx => {
    const cohorts = await tx`
      with sz as (select extract(year from rfs_date)::int as cohort, count(*) as n from atlas.areas where status = 'active' group by 1)
      select extract(year from a.rfs_date)::int as cohort, am.age_m as age,
             (sum(am.active_subs)::numeric / sum(a.homepass))::float as takeup, count(*)::int as areas
      from atlas.area_monthly am join atlas.areas a on a.id = am.area_id
      join sz on sz.cohort = extract(year from a.rfs_date)::int
      group by 1, 2, sz.n
      -- stop a cohort's curve once fewer than 80% of its areas are that old (otherwise the mix shifts)
      having count(*) >= 0.8 * sz.n
      order by 1, 2`
    const plan = await tx`select g as age, (0.15 * atlas.ramp(g) / atlas.ramp(11.5))::float as takeup from generate_series(0, 42) g`
    const partners = await tx`
      select p.id, p.code, p.name, p.model, p.upfront_per_hp, p.fee_per_sub,
             count(v.id)::int as areas, sum(v.homepass)::int as homepass, sum(v.subs)::int as subs,
             (sum(v.subs)::numeric / nullif(sum(v.homepass), 0))::float as takeup,
             (sum(v.bp_takeup * v.homepass) / nullif(sum(v.homepass), 0))::float as plan,
             sum(v.revenue_m)::float as revenue_m, sum(v.margin_m)::float as margin_m, sum(v.cum_margin)::float as cum_margin,
             (sum(v.revenue_m) / nullif(sum(v.subs), 0))::float as arpu,
             percentile_cont(0.5) within group (order by v.payback_proj)::float as payback_med,
             count(*) filter (where v.payback_age is not null)::int as paid_back
      from atlas.partners p join atlas.v_area_perf v on v.partner_id = p.id group by p.id order by p.id`
    const matrix = await tx`
      select v.partner_id, v.partner_code, replace(v.kota, 'Kota ', '') as kota, count(*)::int as areas, sum(v.homepass)::int as homepass,
             (sum(v.subs)::numeric / nullif(sum(v.homepass), 0))::float as takeup,
             (sum(v.subs)::numeric / nullif(sum(v.bp_takeup * v.homepass), 0))::float as vs_plan, sum(v.margin_m)::float as margin_m
      from atlas.v_area_perf v group by 1, 2, 3 order by 2, 3`
    const worst = await tx`
      select code, partner_id, partner_code, replace(kota, 'Kota ', '') as kota, age, homepass, takeup::float, bp_takeup::float, vs_plan::float,
             margin_m::float, payback_proj::float
      from atlas.v_area_perf where age >= 6 order by vs_plan asc limit 12`
    return { cohorts, plan, partners, matrix, worst }
  })

  const tot = d.partners.reduce((a, p) => ({ rev: a.rev + p.revenue_m, mar: a.mar + p.margin_m, cum: a.cum + p.cum_margin, subs: a.subs + p.subs, hp: a.hp + p.homepass }), { rev: 0, mar: 0, cum: 0, subs: 0, hp: 0 })
  const kotas = [...new Set(d.matrix.map(m => m.kota))].sort()
  const SHORT: Record<string, string> = { 'Jakarta Pusat': 'JKP', 'Jakarta Selatan': 'JKS', 'Jakarta Barat': 'JKB', 'Jakarta Timur': 'JKT', 'Jakarta Utara': 'JKU', Depok: 'DPK', Tangerang: 'TNG', 'Tangerang Selatan': 'TSL', Bekasi: 'BKS' }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Profitability analysis</div>
          <h1 className="page-title">Profitability &amp; cohorts</h1>
          <p className="page-sub">By partner, by cluster (kota) and by launch cohort. Margin = revenue − partner wholesale fee − Rp 650K acquisition cost per new subscriber; capex-share partners also bill an upfront fee per home-pass at RFS.</p>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Revenue / month" value={rp(tot.rev)} sub={`ARPU ${rp(tot.rev / Math.max(1, tot.subs))}`} accent="var(--ink)" />
        <Kpi label="Margin / month" value={rp(tot.mar)} sub={`${fmtPct(tot.mar / Math.max(1, tot.rev))} of revenue`} accent={tot.mar >= 0 ? 'var(--chart-good)' : 'var(--chart-bad)'} />
        <Kpi label="Cumulative cash position" value={rp(tot.cum)} sub="all areas since RFS, after upfront fees" accent={tot.cum >= 0 ? 'var(--chart-good)' : 'var(--chart-bad)'} />
        <Kpi label="Take-up vs plan" value={fmtPct(tot.subs / Math.max(1, tot.hp))} sub={`plan at current ages ${fmtPct(d.partners.reduce((a, p) => a + p.plan * p.homepass, 0) / Math.max(1, tot.hp))}`} accent="var(--brand)" />
      </div>

      <div className="cols-even" style={{ marginBottom: 14 }}>
        <Card title="Take-up curve by launch cohort" sub="Subscribers / home-passes by months since RFS, all areas launched in that year, against the business-plan curve.">
          <CohortChart cohorts={d.cohorts as never} plan={d.plan as never} />
        </Card>
        <Card title="Partner economics" sub="Run-rate, last three months.">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Partner</th><th>Model</th><th className="num">Take-up</th><th className="num">Margin/mo</th><th className="num">Payback</th></tr></thead>
              <tbody>
                {d.partners.map(p => (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: 'nowrap' }}><PartnerDot id={p.id} code={p.code} /><div className="small muted">{p.areas} areas · {fmtInt(p.homepass / 1000)}K HP</div></td>
                    <td className="small" style={{ whiteSpace: 'nowrap' }}>{p.model === 'capex_share' ? <>Capex share<div className="muted">{rp(Number(p.upfront_per_hp), 0)}/HP</div><div className="muted">+ {rp(Number(p.fee_per_sub), 0)}/sub</div></> : <>Revenue share<div className="muted">{rp(Number(p.fee_per_sub), 0)}/sub</div></>}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtPct(p.takeup)}<div className="small" style={{ color: p.takeup >= p.plan ? 'var(--pos)' : 'var(--crit)' }}>{p.takeup >= p.plan ? '▲ +' : '▼ '}{((p.takeup - p.plan) * 100).toFixed(1)} pp</div></td>
                    <td className="num">{rp(p.margin_m)}<div className="small muted">{rp(p.margin_m / Math.max(1, p.subs))}/sub</div></td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{months(p.payback_med)}<div className="small muted">{p.paid_back}/{p.areas} paid back</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>Revenue-share partners pay back fast because Indosat carries no build cost, but every subscriber earns less. Capex-share partners need take-up to clear the upfront fee.</p>
        </Card>
      </div>

      <div className="cols-even">
        <Card title="Take-up vs plan by partner × kota" sub="Actual ÷ plan subscribers at each area's age. 100% = on plan. Hover a cell for detail.">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Partner</th>{kotas.map(k => <th key={k} className="num" title={k}>{SHORT[k] ?? k}</th>)}</tr></thead>
              <tbody>
                {d.partners.map(p => (
                  <tr key={p.id}>
                    <td><PartnerDot id={p.id} code={p.code} /></td>
                    {kotas.map(k => {
                      const c = d.matrix.find(m => m.partner_id === p.id && m.kota === k)
                      if (!c) return <td key={k} className="num muted">·</td>
                      const tone = c.vs_plan >= 1 ? 'var(--pos-w)' : c.vs_plan >= 0.85 ? 'var(--mod-w)' : 'var(--crit-w)'
                      return <td key={k} className="num" style={{ background: tone }} title={`${c.areas} areas · ${fmtInt(c.homepass)} HP · take-up ${fmtPct(c.takeup)} · margin ${rp(c.margin_m)}/mo`}>{fmtPct(c.vs_plan, 0)}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="legend" style={{ padding: '10px 0 0' }}>
            <span className="k"><span className="sw" style={{ background: 'var(--pos-w)', border: '1px solid var(--pos)' }} /> ≥ 100% on/above plan</span>
            <span className="k"><span className="sw" style={{ background: 'var(--mod-w)', border: '1px solid var(--mod)' }} /> 85–99%</span>
            <span className="k"><span className="sw" style={{ background: 'var(--crit-w)', border: '1px solid var(--crit)' }} /> below 85%</span>
            <span className="k muted">JKP/JKS/JKB/JKT/JKU = Jakarta Pusat/Selatan/Barat/Timur/Utara · DPK Depok · TNG Tangerang · TSL Tangsel · BKS Bekasi</span>
          </div>
        </Card>
        <Card title="Largest variances" sub="Areas at least 6 months old, furthest below plan.">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Area</th><th className="num">Age</th><th className="num">Take-up</th><th className="num">Plan</th><th className="num">Gap</th><th className="num">Payback</th></tr></thead>
              <tbody>
                {d.worst.map(w => (
                  <tr key={w.code}>
                    <td><span className="mono small">{w.code}</span><div className="small muted">{w.kota}</div></td>
                    <td className="num">{w.age} mo</td>
                    <td className="num">{fmtPct(w.takeup)}</td>
                    <td className="num">{fmtPct(w.bp_takeup)}</td>
                    <td className="num"><Badge tone={w.vs_plan < 0.5 ? 'bad' : 'warn'}>{fmtPct(w.vs_plan, 0)}</Badge></td>
                    <td className="num">{months(w.payback_proj)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  )
}
