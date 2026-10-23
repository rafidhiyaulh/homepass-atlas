import Link from 'next/link'
import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { Kpi } from '@/components/Kpi'
import { PartnerDot } from '@/components/Badge'
import { AreaMap } from '@/components/views/AreaMap'
import { PlanBars } from '@/components/charts/PlanBars'
import { fmtInt, fmtPct, rp } from '@/lib/format'
import { Explainer } from '@/components/Explain'
import { Term } from '@/components/Help'

export default async function Overview() {
  const me = await requireMe()
  const d = await asUser(me, async tx => {
    const [t] = await tx`
      select count(*)::int as areas, sum(homepass)::int as homepass, sum(subs)::int as subs,
             sum(subs)::numeric / nullif(sum(homepass), 0) as takeup,
             sum(bp_takeup * homepass) / nullif(sum(homepass), 0) as plan,
             sum(revenue_m) as revenue_m, sum(margin_m) as margin_m, max(as_of) as as_of,
             count(*) filter (where vs_plan < 0.85)::int as behind
      from atlas.v_area_perf`
    const actions = await tx`select action, count(*)::int as n from atlas.v_portfolio group by 1`
    const partners = await tx`
      select p.id, p.code, p.name, count(v.id)::int as areas, coalesce(sum(v.homepass), 0)::int as homepass, coalesce(sum(v.subs), 0)::int as subs,
             sum(v.subs)::numeric / nullif(sum(v.homepass), 0) as takeup, sum(v.bp_takeup * v.homepass) / nullif(sum(v.homepass), 0) as plan,
             sum(v.revenue_m) as revenue_m, sum(v.margin_m) as margin_m
      from atlas.partners p left join atlas.v_area_perf v on v.partner_id = p.id group by p.id order by p.id`
    const areas = await tx`
      select v.id, v.code, v.partner_id, v.partner_code, v.action, v.takeup::float as takeup, v.homepass,
             ST_AsGeoJSON(ST_SimplifyPreserveTopology(v.geom, 0.0001), 5)::json as geom
      from atlas.v_portfolio v`
    const [grid] = await tx`
      select count(*) filter (where rfs_reco = 'build')::int as build, count(*) filter (where rfs_reco = 'fwa')::int as fwa,
             sum(homepass_est) filter (where rfs_reco = 'build')::int as build_hp, sum(homepass_est)::int as market_hp
      from atlas.h3_cells`
    const batches = await tx`select id, filename, status, polygons, stats from atlas.batches order by created_at desc limit 4`
    return { t, actions, partners, areas, grid, batches }
  })
  const { t, partners, grid } = d
  const act = Object.fromEntries(d.actions.map(a => [a.action, a.n]))
  const asOf = t.as_of ? new Date(t.as_of).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '-'

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jakarta and surrounding cities, data up to {asOf}</div>
          <h1 className="page-title">Market overview</h1>
          <p className="page-sub">
            {me.role === 'partner'
              ? 'Partner view: only your own areas.'
              : 'The home broadband business on one screen.'}
          </p>
        </div>
        <div className="toolbar">
          <Link className="btn" href="/hygiene">Check a partner KMZ</Link>
          <Link className="btn btn-primary" href="/rfs">Find where to build next</Link>
        </div>
      </div>

      <Explainer
        question="How many homes can we reach? How many buy?"
        read="Big numbers on top. Live areas on the map."
        why="Shows where we are strong and where we lag."
      />

      <div className="kpis">
        <Kpi label="Home-passes" term="homepass" value={fmtInt(t.homepass)} sub={`in ${t.areas} live areas, built by ${partners.filter(p => p.areas > 0).length} partners`} accent="var(--brand)" />
        <Kpi label="Paying customers" value={fmtInt(t.subs)} sub={`${fmtPct(Number(t.takeup))} of homes buy, plan was ${fmtPct(Number(t.plan))}`} accent="var(--ink)" />
        <Kpi label="Revenue per year" value={rp(Number(t.revenue_m) * 12)} sub={`about ${rp(Number(t.revenue_m))} each month`} accent="var(--ink)" />
        <Kpi label="Profit per year" term="margin" value={rp(Number(t.margin_m) * 12)} sub="after paying partners and installation costs" accent={Number(t.margin_m) >= 0 ? 'var(--chart-good)' : 'var(--chart-bad)'} />
        <Kpi label="Areas behind plan" term="plan" value={fmtInt(t.behind)} sub={`${act.exit ?? 0} to exit, ${act.optimize ?? 0} to fix, ${act.maintain ?? 0} healthy`} accent="var(--chart-warn)" />
      </div>

      <div className="cols-2">
        <section className="card">
          <div className="card-head"><div><h2 className="card-title">Where we sell today</h2><div className="card-sub">Each shape is a live area. Point at one for numbers.</div></div></div>
          <AreaMap areas={d.areas as never} partners={partners.map(p => ({ id: p.id, code: p.code, name: p.name }))} />
        </section>
        <div className="grid" style={{ alignContent: 'start' }}>
          <section className="card">
            <div className="card-head"><div><h2 className="card-title">How well each partner&apos;s homes sell</h2><div className="card-sub">Bar is <Term k="takeup">take-up</Term> today. Black line is the plan.</div></div></div>
            <div className="card-pad">
              <PlanBars
                unit="pct"
                rows={partners.filter(p => p.areas > 0).map(p => ({
                  key: p.code, label: <PartnerDot id={p.id} code={p.code} name={p.name} />, actual: Number(p.takeup), plan: Number(p.plan), color: `var(--partner-${p.id})`,
                  detail: `${fmtInt(p.subs)} customers out of ${fmtInt(p.homepass)} homes`,
                }))}
              />
            </div>
          </section>
          <section className="card card-pad">
            <h2 className="card-title">What to do next</h2>
            <div className="stack" style={{ marginTop: 8 }}>
              <div className="row between">
                <span><span className="strong">{fmtInt(grid.build)}</span> new neighbourhoods earn back fiber within 30 months</span>
                <Link href="/rfs" className="small">Open →</Link>
              </div>
              <div className="small muted">About {fmtInt(grid.build_hp)} homes. {fmtInt(grid.fwa)} more suit <Term k="fwa">HiFi Air</Term>.</div>
              <div className="hr" />
              <div className="row between">
                <span><span className="strong">{fmtInt(act.exit ?? 0)}</span> areas to exit and <span className="strong">{fmtInt(act.optimize ?? 0)}</span> to fix</span>
                <Link href="/portfolio" className="small">Open →</Link>
              </div>
              <div className="hr" />
              <div className="small strong">Latest KMZ checks</div>
              {d.batches.length === 0 && <div className="small muted">None yet.</div>}
              {d.batches.map(b => (
                <div key={b.id} className="row between small">
                  <Link href={`/hygiene/${b.id}`}>{b.filename}</Link>
                  <span className="muted">
                    {b.status === 'done'
                      ? `${(b.stats?.by_status?.clean ?? 0) + (b.stats?.by_status?.touch ?? 0)} of ${b.polygons} clean, ${fmtInt(b.stats?.homepass_dup)} homes double counted`
                      : b.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
