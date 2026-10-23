// Request path left to right on the top row, the async path (queue + workers) and AI below,
// the offline data pipeline at the bottom. Arrows are routed so none crosses a box or another arrow.
const box = (x: number, y: number, w: number, h: number, title: string, lines: string[], accent = false) => (
  <g key={title}>
    <rect x={x} y={y} width={w} height={h} rx={9} fill="var(--panel)" stroke={accent ? 'var(--ink2)' : 'var(--rule2)'} strokeWidth={accent ? 1.6 : 1} />
    <text x={x + 12} y={y + 22} fontSize={13} fontWeight={750} fill="var(--ink)">{title}</text>
    {lines.map((l, i) => <text key={i} x={x + 12} y={y + 42 + i * 16} fontSize={11.5} fill="var(--ink2)">{l}</text>)}
  </g>
)
const path = (d: string, key: string) => <path key={key} d={d} fill="none" stroke="var(--ink2)" strokeWidth={1.4} markerEnd="url(#ah)" />
const label = (x: number, y: number, t: string, anchor: 'start' | 'middle' | 'end' = 'middle') => (
  <text x={x} y={y} fontSize={11} fill="var(--muted)" textAnchor={anchor}>{t}</text>
)

export function Diagram() {
  return (
    <div style={{ overflowX: 'auto', marginTop: 12 }}>
      <svg viewBox="0 0 1100 450" width="100%" style={{ minWidth: 900, display: 'block' }} role="img"
        aria-label="Browser calls the Next.js app on Vercel, which queries Postgres as the user and fans out workers that consume a pgmq queue; Gemini is called for questions and notes; an offline Python pipeline seeds the database from Overture building data.">
        <defs>
          <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink2)" /></marker>
        </defs>
        <text x={20} y={16} fontSize={10.5} fontWeight={700} letterSpacing="0.14em" fill="var(--muted)">BROWSER</text>
        <text x={250} y={16} fontSize={10.5} fontWeight={700} letterSpacing="0.14em" fill="var(--muted)">VERCEL (iad1)</text>
        <text x={640} y={16} fontSize={10.5} fontWeight={700} letterSpacing="0.14em" fill="var(--muted)">SUPABASE (us-east-1)</text>

        {box(20, 44, 190, 110, 'Planner / partner', ['Next.js UI, Leaflet maps', 'Supabase Auth session', 'KMZ goes straight to private', 'Storage (signed URL)'])}
        {box(250, 44, 330, 110, 'Next.js 16 app', ['proxy.ts: session refresh + gate', 'server components → SQL as the user', 'route handlers /api/*', 'CSP, HSTS, rate limits'], true)}
        {box(640, 44, 220, 110, 'Postgres 17, schema atlas', ['PostGIS, GiST indexes', 'RLS on every table', 'views: perf, cohorts, portfolio'], true)}
        {box(900, 44, 180, 110, 'Auth + Storage', ['JWT issuer, verified', 'server-side', 'private bucket'])}

        {box(20, 214, 190, 100, 'Gemini', ['OpenAI-compatible API', 'JSON-schema output', 'numeric grounding check'])}
        {box(250, 214, 330, 100, 'Workers × N  (/api/worker)', ['competing consumers, 60 s visibility', 'process_shard → classify pairs', 'last one finalises (conditional UPDATE)'])}
        {box(640, 214, 220, 100, 'pgmq + pg_cron', ['queue atlas_shards + dead letters', 'cron re-kicks workers every', 'minute while the queue is not empty'])}

        {box(20, 354, 190, 80, 'Data sources', ['Overture Maps buildings', 'BPS kota boundaries'])}
        {box(250, 354, 330, 80, 'Offline pipeline (Python)', ['DuckDB over S3 → 3.2M buildings → H3 res 8', 'sample registry, LightGBM + SHAP'])}

        {path('M210,99 L248,99', 'a1')}{label(229, 91, 'HTTPS')}
        {path('M580,85 L638,85', 'a2')}{label(609, 77, 'SET ROLE')}
        {path('M560,44 L560,30 L990,30 L990,42', 'a3')}{label(1000, 26, 'login check, upload links', 'end')}
        {path('M300,154 L300,184 L115,184 L115,212', 'a4')}{label(207, 178, 'questions, notes')}
        {path('M415,154 L415,212', 'a5')}{label(423, 188, 'after(): fan-out', 'start')}
        {path('M750,154 L750,212', 'a6')}{label(758, 188, 'enqueue shards', 'start')}
        {path('M638,264 L582,264', 'a7')}{label(610, 256, 'take job')}
        {path('M210,394 L248,394', 'a8')}
        {path('M580,394 L880,394 L880,120 L862,120', 'a9')}{label(730, 386, 'seed')}
      </svg>
    </div>
  )
}
