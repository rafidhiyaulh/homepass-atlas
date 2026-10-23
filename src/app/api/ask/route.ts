import { apiError, apiMe, HttpError } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { rateLimit } from '@/lib/guard'
import { chat, llmModel } from '@/lib/llm'
import { ASK_SCHEMA, askPrompt, compile, type Plan } from '@/lib/ask'

export const maxDuration = 30

export async function POST(request: Request) {
  try {
    const me = await apiMe()
    await rateLimit(me, 'llm', 20, 60)
    const body = await request.json().catch(() => ({}))
    const q = String(body?.q ?? '').trim()
    if (q.length < 3 || q.length > 400) throw new HttpError(400, 'bad_request', 'Ask in 3-400 characters')
    const raw = await chat(askPrompt(q), { json: ASK_SCHEMA, maxTokens: 600 })
    if (!raw) throw new HttpError(502, 'llm_unavailable', 'The model is unavailable right now')
    let plan: Plan
    try { plan = JSON.parse(raw) } catch { throw new HttpError(502, 'unreadable', 'The model answer was not valid JSON') }
    const c = compile(plan)
    // runs as the signed-in user: RLS still decides which rows exist
    const rows = await asUser(me, tx => tx.unsafe(c.text, c.params as never[]))
    await asUser(me, tx => tx`select atlas.audit('ask', ${q.slice(0, 200)}, ${tx.json({ entity: plan.entity, filters: plan.filters, dropped: c.dropped, rows: rows.length } as never)})`)
    return Response.json({
      entity: plan.entity, understood: String(plan.understood ?? '').slice(0, 300), unsupported: String(plan.unsupported ?? '').slice(0, 300),
      filters: plan.filters, dropped: c.dropped, sort: c.sort, columns: c.columns, rows, model: llmModel(),
    })
  } catch (e) {
    return apiError(e)
  }
}
