import 'server-only'

// Gemini through its OpenAI-compatible endpoint (same pattern as Perisai): LLM_BASE_URL, LLM_API_KEY, LLM_MODEL.
// No key => every caller falls back to its deterministic output. The model only ever sees aggregates
// (no personal data), and free text it writes must pass `grounded()` before it is shown.

export const llmConfigured = () => Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL)
export const llmModel = () => process.env.LLM_MODEL ?? null

type Msg = { role: 'system' | 'user'; content: string }

export async function chat(messages: Msg[], opts: { json?: object; maxTokens?: number; timeoutMs?: number } = {}) {
  if (!llmConfigured()) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000)
  try {
    const res = await fetch(process.env.LLM_BASE_URL!.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.LLM_API_KEY}` },
      body: JSON.stringify({
        model: process.env.LLM_MODEL,
        messages,
        temperature: 0,
        max_tokens: opts.maxTokens ?? 800,
        reasoning_effort: 'none',
        ...(opts.json ? { response_format: { type: 'json_schema', json_schema: { name: 'out', strict: true, schema: opts.json } } } : {}),
      }),
    })
    if (!res.ok) {
      console.error('llm http', res.status, (await res.text()).slice(0, 300))
      return null
    }
    const body = await res.json()
    return (body?.choices?.[0]?.message?.content as string | undefined)?.trim() ?? null
  } catch (e) {
    console.error('llm error', (e as Error).name)
    return null
  } finally {
    clearTimeout(timer)
  }
}

const NUM = /\d[\d.,]*%?/g

function numbersIn(v: unknown, acc = new Set<string>()): Set<string> {
  if (v == null) return acc
  if (typeof v === 'number') {
    const add = (s: string) => acc.add(s)
    add(String(v)); add(v.toFixed(0)); add(v.toFixed(1)); add(v.toFixed(2))
    add((v * 100).toFixed(0)); add((v * 100).toFixed(1))                      // ratios written as %
    add(Math.round(v).toLocaleString('en-US')); add(Math.round(v).toLocaleString('id-ID'))
    for (const unit of [1e3, 1e6, 1e9, 1e12]) if (Math.abs(v) >= unit) { add((v / unit).toFixed(0)); add((v / unit).toFixed(1)) }
  } else if (typeof v === 'string') {
    for (const m of v.match(NUM) ?? []) acc.add(m.replace(/%$/, ''))
  } else if (Array.isArray(v)) v.forEach(x => numbersIn(x, acc))
  else if (typeof v === 'object') Object.values(v as object).forEach(x => numbersIn(x, acc))
  return acc
}

// Every number in the text must be derivable from the source facts, otherwise reject the text.
export function grounded(text: string, source: unknown, extra: string[] = []) {
  const ok = numbersIn(source)
  extra.forEach(x => ok.add(x))
  for (const n of ['0', '1', '2', '3', '4', '5', '6', '12', '24', '36', '48', '60', '100']) ok.add(n)
  const norm = (s: string) => s.replace(/%$/, '').replace(/[.,]$/, '')
  const variants = (s: string) => [s, s.replace(/,/g, ''), s.replace(/\./g, ''), s.replace(/,/g, '.'), s.replace(/\./g, ',')]
  const unexplained = (text.match(NUM) ?? []).map(norm).filter(n => !variants(n).some(x => ok.has(x)))
  return { ok: unexplained.length === 0, unexplained }
}
