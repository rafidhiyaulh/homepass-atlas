import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { Diagram } from './Diagram'
import { SqlTabs } from './SqlTabs'
import { Explainer } from '@/components/Explain'

export const metadata = { title: 'How it is built' }

const PILLARS = [
  {
    n: '1', title: 'Relational database', plain: 'One organised home for all data. Rules decide who sees what.', items: [
      'Postgres 17 with PostGIS for map math.',
      'Own schema "atlas", isolated from other apps.',
      'Tables: partners, areas, monthly results, uploads, shapes, clashes.',
      'Spatial indexes make overlap checks fast.',
      'Reports are SQL views that respect access rules.',
    ],
  },
  {
    n: '2', title: 'APIs + backend', plain: 'Doors the screens use to get data.', items: [
      '11 endpoints: upload, check, export, predict, ask.',
      'Heavy map logic runs inside the database.',
      'Every error returns a clear code.',
    ],
  },
  {
    n: '3', title: 'Distributed systems', plain: 'Big files split into parts, checked in parallel. Nothing is lost if one fails.', items: [
      'Each upload becomes jobs in a queue (pgmq).',
      'Several workers pull jobs at the same time.',
      'A crashed job reappears after 60 seconds.',
      'Re-running a job never double counts.',
      'Exactly one worker merges the final result.',
      'Failed jobs move aside after 3 tries.',
      'A timer restarts workers if the queue stalls.',
    ],
  },
  {
    n: '4', title: 'AI / ML', plain: 'A model predicts sales. AI answers questions and writes summaries.', items: [
      'LightGBM predicts take-up from real building data.',
      'Tested only on areas it never saw.',
      'SHAP explains every single prediction.',
      'Gemini turns questions into approved filters, never SQL.',
      'Any AI number not in the data is rejected.',
    ],
  },
  {
    n: '5', title: 'Cloud + deployment', plain: 'Runs online, no servers to manage. Updates ship from Git.', items: [
      'Website and APIs on Vercel.',
      'Database, login, files and queue on Supabase.',
      'Servers sit next to the database for speed.',
      'Data pipeline: DuckDB, H3 grid, model, then load.',
    ],
  },
  {
    n: '6', title: 'Security / networking', plain: 'Everyone sees only their data. Uploads are checked first.', items: [
      'Login by Supabase Auth, verified on every request.',
      'Partners see only their own areas (RLS).',
      'The app account owns nothing in the database.',
      'Uploads blocked if zip bombs or hidden XML tricks.',
      'Files stored privately, upload links expire.',
      'Worker secret kept in a vault.',
      'Browser security headers on every page.',
    ],
  },
]

export default async function Page() {
  const me = await requireMe()
  const [s] = await asUser(me, tx => tx`select (select count(*) from atlas.h3_cells)::int as cells, (select sum(buildings) from atlas.h3_cells)::int as buildings,
    (select count(*) from atlas.areas)::int as areas, (select count(*) from atlas.area_monthly)::int as monthly`)
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Architecture</div>
          <h1 className="page-title">How it is built</h1>
          <p className="page-sub">What runs behind the pages, and why each piece is there.</p>
        </div>
      </div>
      <Explainer
        question="How does the site work behind the screens?"
        read="The diagram follows one request. Six cards, six building blocks."
        why="Shows it is secure, scalable and easy to check."
      />

      <section className="card card-pad" style={{ marginBottom: 14 }}>
        <h2 className="card-title">System</h2>
        <Diagram />
      </section>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', marginBottom: 14 }}>
        {PILLARS.map(p => (
          <section key={p.n} className="card card-pad">
            <div className="row" style={{ gap: 10 }}>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--brand-fill)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800 }}>{p.n}</span>
              <h2 className="card-title" style={{ margin: 0 }}>{p.title}</h2>
            </div>
            <p className="strong" style={{ marginTop: 10 }}>{p.plain}</p>
            <ul style={{ margin: '10px 0 0 18px', display: 'grid', gap: 6 }}>
              {p.items.map((i, k) => <li key={k} style={{ color: 'var(--ink2)' }}>{i}</li>)}
            </ul>
          </section>
        ))}
      </div>

      <section className="card card-pad" style={{ marginBottom: 14 }}>
        <h2 className="card-title">The overlap check in SQL</h2>
        <p className="card-sub" style={{ marginBottom: 10 }}>Same check, three tools. Use whichever you have open.</p>
        <SqlTabs />
      </section>

      <div className="cols-even">
        <section className="card card-pad">
          <h2 className="card-title">What data is real</h2>
          <ul style={{ margin: '10px 0 0 18px', display: 'grid', gap: 6, color: 'var(--ink2)' }}>
            <li><b>Real:</b> {s.buildings?.toLocaleString('en-US')} building outlines, Overture Maps.</li>
            <li><b>Real:</b> city borders from BPS.</li>
            <li><b>Estimated:</b> homes per hexagon, from building sizes.</li>
            <li><b>Sample:</b> partners, {s.areas} areas, customers, revenue, competitors.</li>
            <li>No Indosat data is used.</li>
          </ul>
        </section>
        <section className="card card-pad">
          <h2 className="card-title">Next steps with real data</h2>
          <ul style={{ margin: '10px 0 0 18px', display: 'grid', gap: 6, color: 'var(--ink2)' }}>
            <li>Use real partner home-pass address lists.</li>
            <li>Check home counts against BPS household data.</li>
            <li>Retrain on real sales, split by time.</li>
            <li>Run the overlap check nationwide in BigQuery.</li>
            <li>Feed monthly results back into the scores.</li>
          </ul>
        </section>
      </div>
    </>
  )
}
