import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { PortfolioView } from './PortfolioView'
import { Explainer } from '@/components/Explain'

export const metadata = { title: 'Portfolio actions' }

export default async function Page() {
  const me = await requireMe()
  const areas = await asUser(me, tx => tx`
    select id, code, name, partner_id, partner_code, replace(kota, 'Kota ', '') as kota, age, homepass, subs,
           takeup::float, bp_takeup::float, vs_plan::float, margin_m::float, churn_m::float, payback_proj::float, action, reasons,
           ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0001), 5)::json as geom
    from atlas.v_portfolio order by vs_plan`)
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Deciding what to do with each area</div>
          <h1 className="page-title">Portfolio actions</h1>
          <p className="page-sub">Keep, fix or exit, for every live area.</p>
        </div>
      </div>
      <Explainer
        question="Which areas do we keep, fix or exit?"
        read="Pick a group, then click an area. See the cause and the fix."
        why="Weak areas take money from good ones."
      />
      <PortfolioView areas={areas as never} />
    </>
  )
}
