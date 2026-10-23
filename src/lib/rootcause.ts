import 'server-only'
import type { Tx } from './db'

export type Facts = {
  code: string; name: string; partner: string; partner_model: string; kota: string; age_months: number; action: string
  homepass: number; subs: number; takeup_pct: number; plan_pct: number; vs_plan_pct: number
  peer_takeup_pct: number | null; churn_pct: number; peer_churn_pct: number | null
  margin_month_idr: number; payback_months: number | null
  competitors_avg: number; mdu_share_pct: number; avg_building_m2: number | null; reasons: string[]
}

// Facts for one area (through RLS) plus the same numbers for its peers: same partner, same kota, other areas.
export async function areaFacts(tx: Tx, id: number): Promise<Facts | null> {
  const [a] = await tx`
    with me as (select * from atlas.v_portfolio where id = ${id}),
    cells as (
      select avg(c.competitors)::float as competitors, avg(c.mdu_share)::float as mdu,
             (sum(c.footprint_m2) / nullif(sum(c.buildings), 0))::float as avg_bldg
      from atlas.h3_cells c, me where c.geom && me.geom and ST_Intersects(ST_Centroid(c.geom), me.geom)
    ),
    peers as (
      select (sum(v.subs)::numeric / nullif(sum(v.homepass), 0))::float as takeup, avg(v.churn_m)::float as churn
      from atlas.v_area_perf v, me where v.id <> me.id and v.age >= 6 and (v.partner_id = me.partner_id or v.kota = me.kota)
    )
    select me.code, me.name, me.partner_name, p.model, me.kota, me.age, me.action, me.reasons, me.homepass, me.subs,
           me.takeup::float, me.bp_takeup::float, me.vs_plan::float, me.churn_m::float, me.margin_m::float, me.payback_proj::float,
           cells.competitors, cells.mdu, cells.avg_bldg, peers.takeup as peer_takeup, peers.churn as peer_churn
    from me join atlas.partners p on p.id = me.partner_id, cells, peers`
  if (!a) return null
  const r1 = (v: number) => Math.round(v * 10) / 10
  return {
    code: a.code, name: a.name, partner: a.partner_name, partner_model: a.model === 'capex_share' ? 'capex share' : 'revenue share',
    kota: String(a.kota).replace('Kota ', ''), age_months: a.age, action: a.action,
    homepass: a.homepass, subs: a.subs, takeup_pct: r1(a.takeup * 100), plan_pct: r1(a.bp_takeup * 100), vs_plan_pct: Math.round(a.vs_plan * 100),
    peer_takeup_pct: a.peer_takeup == null ? null : r1(a.peer_takeup * 100),
    churn_pct: r1(a.churn_m * 100), peer_churn_pct: a.peer_churn == null ? null : r1(a.peer_churn * 100),
    margin_month_idr: Math.round(a.margin_m), payback_months: a.payback_proj == null ? null : Math.round(a.payback_proj),
    competitors_avg: r1(a.competitors ?? 0), mdu_share_pct: Math.round((a.mdu ?? 0) * 100), avg_building_m2: a.avg_bldg == null ? null : Math.round(a.avg_bldg),
    reasons: a.reasons,
  }
}

// Deterministic diagnosis: each observed driver maps to a lever the team can actually pull.
export function diagnose(f: Facts) {
  const drivers: { driver: string; evidence: string; lever: string }[] = []
  if (f.peer_takeup_pct != null && f.takeup_pct < f.peer_takeup_pct * 0.8)
    drivers.push({ driver: 'Converts worse than its peers', evidence: `take-up ${f.takeup_pct}% vs ${f.peer_takeup_pct}% for the same partner or kota`, lever: 'Door-to-door sales sprint and an RFS awareness campaign in the cluster' })
  if (f.competitors_avg >= 3)
    drivers.push({ driver: 'Crowded market', evidence: `${f.competitors_avg} fiber brands present on average`, lever: 'Bundle with Indosat mobile (FMC) or a local price response instead of a broad discount' })
  if (f.mdu_share_pct >= 25)
    drivers.push({ driver: 'High-rise / MDU heavy', evidence: `${f.mdu_share_pct}% of footprint in mid-size buildings`, lever: 'Building-access deals with property managers; in-building partner coverage check' })
  if (f.peer_churn_pct != null && f.churn_pct > f.peer_churn_pct * 1.25)
    drivers.push({ driver: 'Churn above peers', evidence: `${f.churn_pct}% monthly vs ${f.peer_churn_pct}%`, lever: 'Partner SLA review (outage and install times) and a retention offer at month 10-12' })
  if (f.margin_month_idr <= 0)
    drivers.push({ driver: 'Negative contribution', evidence: 'monthly margin is below zero', lever: 'Renegotiate the partner fee or stop acquisition spend' })
  if (!drivers.length)
    drivers.push({ driver: 'No single driver stands out', evidence: 'peers, competition and churn are all near normal', lever: 'Keep monitoring; check field feedback for local causes' })
  const verdict =
    f.action === 'exit' ? `Exit: take-up is ${f.vs_plan_pct}% of plan after ${f.age_months} months and the area ${f.payback_months == null ? 'does not pay back at today\'s margin' : `needs ${f.payback_months} months to pay back`}.`
      : f.action === 'optimize' ? `Optimize: take-up is ${f.vs_plan_pct}% of plan at month ${f.age_months}${f.payback_months != null ? `, payback ${f.payback_months} months` : ''}.`
        : f.action === 'maintain' ? `Maintain: take-up is ${f.vs_plan_pct}% of plan at month ${f.age_months}.`
          : `Ramping: only ${f.age_months} months since RFS, too early to judge.`
  return { verdict, drivers }
}
