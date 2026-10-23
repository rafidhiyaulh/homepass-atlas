import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { HygieneHome } from './HygieneHome'

export const metadata = { title: 'Boundary hygiene' }

export default async function Page() {
  const me = await requireMe()
  const partners = await asUser(me, tx => tx`select id, code, name from atlas.partners order by id`)
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Home-pass data integrity</div>
          <h1 className="page-title">Boundary hygiene</h1>
          <p className="page-sub">
            Upload a partner&apos;s KMZ. Every polygon is checked against the others in the file and against the live home-pass registry,
            then labelled clean, touch-only, sliver, overlap, duplicate or self-intersecting. Only clean area should be counted as home-passes.
          </p>
        </div>
      </div>
      <HygieneHome partners={partners.map(p => ({ id: p.id, code: p.code, name: p.name }))} role={me.role} myPartner={me.partner_id} />
    </>
  )
}
