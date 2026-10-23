import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { PortfolioView } from './PortfolioView'

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
          <div className="eyebrow">Performance monitoring · portfolio optimization</div>
          <h1 className="page-title">Portfolio actions</h1>
          <p className="page-sub">
            Every RFS area gets maintain, optimize or exit from transparent rules on take-up vs plan, projected payback and churn.
            Open an area for the root cause and the levers; Gemini can turn that into a short note for management.
          </p>
        </div>
      </div>
      <PortfolioView areas={areas as never} />
    </>
  )
}
