import { apiError, apiMe, HttpError } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { rateLimit } from '@/lib/guard'
import { areaFacts, diagnose } from '@/lib/rootcause'
import { chat, grounded, llmModel } from '@/lib/llm'

export const maxDuration = 30

// Gemini rewrites the deterministic diagnosis into a short note for a manager. It only sees the
// aggregate facts below; any number it writes that is not in the facts gets the text rejected.
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await apiMe()
    const id = Number((await params).id)
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'bad_request')
    await rateLimit(me, 'llm', 20, 60)
    const facts = await asUser(me, tx => areaFacts(tx, id))
    if (!facts) throw new HttpError(404, 'not_found')
    const diagnosis = diagnose(facts)
    const source = { facts, diagnosis }
    const text = await chat([
      { role: 'system', content: 'You are a telecom home-broadband market planning analyst at Indosat. Write for the Head of HBB Market Planning. Plain English, no hype, no markdown headings.' },
      { role: 'user', content:
        'Write at most 80 words in 3 to 4 short sentences: the verdict, the most likely root cause, and the first two actions. ' +
        'Use ONLY the facts in the JSON. Do not invent numbers, dates, competitors or partners. Keep percentages exactly as given.\n' +
        JSON.stringify(source) },
    ], { maxTokens: 400 })
    if (!text) return Response.json({ text: null, grounded: false, model: null, reason: 'llm_unavailable' })
    const g = grounded(text, source)
    await asUser(me, tx => tx`select atlas.audit('llm.narrative', ${facts.code}, ${tx.json({ grounded: g.ok, unexplained: g.unexplained } as never)})`)
    return Response.json({ text: g.ok ? text : null, grounded: g.ok, unexplained: g.unexplained, model: llmModel() })
  } catch (e) {
    return apiError(e)
  }
}
