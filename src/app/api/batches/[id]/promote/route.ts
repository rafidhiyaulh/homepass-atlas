import { apiError, apiMe, HttpError } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { UUID } from '@/lib/guard'

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await apiMe()
    if (me.role !== 'planner') throw new HttpError(403, 'forbidden', 'Only planners can change the registry')
    const { id } = await params
    if (!UUID.test(id)) throw new HttpError(400, 'bad_request')
    const [r] = await asUser(me, tx => tx`select atlas.promote_batch(${id}, true) as n`)
    return Response.json({ promoted: r.n })
  } catch (e) {
    return apiError(e)
  }
}
