import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { HygieneHome } from './HygieneHome'
import { Explainer } from '@/components/Explain'
import { Term } from '@/components/Help'

export const metadata = { title: 'Boundary hygiene' }

export default async function Page() {
  const me = await requireMe()
  const partners = await asUser(me, tx => tx`select id, code, name from atlas.partners order by id`)
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Keeping the home-pass list accurate</div>
          <h1 className="page-title">Boundary hygiene</h1>
          <p className="page-sub">Check a partner&apos;s coverage map before its homes are counted.</p>
        </div>
      </div>
      <Explainer
        question={<>Which shapes in this <Term k="kmz">KMZ</Term> are <Term k="clean">clean</Term>?</>}
        read="Upload a file. Green is clean, orange and red need fixing."
        why="Overlaps count homes twice. That hides weak sales."
      />
      <HygieneHome partners={partners.map(p => ({ id: p.id, code: p.code, name: p.name }))} role={me.role} myPartner={me.partner_id} />
    </>
  )
}
