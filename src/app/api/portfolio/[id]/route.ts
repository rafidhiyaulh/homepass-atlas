import { apiError, apiMe, HttpError } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { areaFacts, diagnose } from '@/lib/rootcause'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await apiMe()
    const id = Number((await params).id)
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'bad_request')
    const facts = await asUser(me, tx => areaFacts(tx, id))
    if (!facts) throw new HttpError(404, 'not_found')
    const series = await asUser(me, tx => tx`select age_m as age, active_subs as subs, revenue::float, partner_cost::float from atlas.area_monthly where area_id = ${id} order by month`)
    return Response.json({ facts, diagnosis: diagnose(facts), series })
  } catch (e) {
    return apiError(e)
  }
}
