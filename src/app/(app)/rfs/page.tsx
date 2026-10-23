import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { RfsView } from './RfsView'
import { Explainer } from '@/components/Explain'
import { Term } from '@/components/Help'

export const metadata = { title: 'RFS desktop study' }

export default async function Page() {
  const me = await requireMe()
  const d = await asUser(me, async tx => {
    const cells = await tx`
      select h3, kota, buildings, homepass_est, round(mdu_share::numeric, 3)::float as mdu_share, round(dist_cbd_km::numeric, 1)::float as dist_cbd_km,
             competitors, covered_area_id is not null as covered, pred_takeup_m12::float as p12, pred_takeup_m24::float as p24,
             drivers, rfs_score::float as score, rfs_reco as reco, payback_months::float as payback,
             ST_AsGeoJSON(geom, 5)::json as geom
      from atlas.h3_cells`
    const [model] = await tx`select model, target, metrics, importance, notes, created_at from atlas.model_runs order by id desc limit 1`
    return { cells, model }
  })
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Choosing the next areas to build</div>
          <h1 className="page-title">RFS desktop study</h1>
          <p className="page-sub">Where should the next fiber go?</p>
        </div>
      </div>
      <Explainer
        question={<>Where should our next fiber go? Where fits <Term k="fwa">HiFi Air</Term>?</>}
        read={<>Each <Term k="hex">hexagon</Term> is a neighbourhood. Darker means more value.</>}
        why="Building is expensive. Start where money returns fastest."
      />
      <RfsView cells={d.cells as never} model={d.model as never} />
    </>
  )
}
