import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { Diagram } from './Diagram'
import { SqlTabs } from './SqlTabs'

export const metadata = { title: 'How it is built' }

const PILLARS = [
  {
    n: '1', title: 'Relational database', items: [
      'Postgres 17 + PostGIS on Supabase, everything in its own schema `atlas` (shares a project with another app without touching it)',
      'Normalised registry: partners → areas → area_monthly; uploads: batches → boundaries → conflicts; H3 market grid with GiST spatial indexes',
      'Analytics as SQL views (v_area_perf, v_portfolio, v_cohort_curve) with security_invoker, so they inherit row-level security',
      'Versioned migrations in db/migrations, applied by scripts/migrate.mjs',
    ],
  },
  {
    n: '2', title: 'APIs + backend', items: [
      'Next.js 16 route handlers: /api/uploads/sign, /api/batches (+/:id, /geo, /export, /promote), /api/worker, /api/portfolio/:id(+/narrative), /api/rfs/export, /api/ask',
      'Server components query Postgres directly; client components fetch JSON for live state (polling batch progress)',
      'Business logic close to the data: pair classification, finalisation and promotion are PL/pgSQL functions',
      'Consistent error contract { error, code } with HTTP status mapped from Postgres error classes',
    ],
  },
  {
    n: '3', title: 'Distributed systems', items: [
      'A KMZ is split into shards (polygon ranges) and queued on pgmq; N independent serverless invocations consume the queue as competing workers',
      'At-least-once delivery: a read message is invisible for 60 s and reappears if a worker dies; shards are idempotent (delete-then-insert), so a retry is harmless',
      'Exactly-once finalisation without a lock service: the worker whose conditional UPDATE flips the batch to "finalizing" does the merge',
      'Poison messages go to a dead-letter queue after 3 attempts; pg_cron re-kicks workers every minute while the queue is non-empty',
      'Rate limits are counted in Postgres, so they hold across every instance, not per process',
    ],
  },
  {
    n: '4', title: 'AI / ML', items: [
      'LightGBM take-up model on real building features (Overture Maps footprints → H3), validated with GroupKFold by RFS area to stop leakage',
      'Per-cell SHAP contributions (TreeSHAP) shown as the "why" behind every RFS recommendation; model card with error vs a mean-only baseline',
      'Gemini (OpenAI-compatible endpoint, same pattern as Perisai) for two jobs: question → whitelisted structured filter, and diagnosis → short management note',
      'Guardrails: JSON schema output, server-side re-validation, no SQL from the model, and a numeric grounding check that rejects any number not in the facts',
    ],
  },
  {
    n: '5', title: 'Cloud + deployment', items: [
      'Vercel (Next.js, serverless functions, after() fan-out) and Supabase (Postgres, Auth, Storage, pgmq, pg_cron, pg_net)',
      'Functions pinned to iad1, next to the database in us-east-1: each request makes several round trips, so co-location is the biggest latency lever',
      'Offline data pipeline (scripts/pipeline): DuckDB over Overture S3 → H3 aggregates → synthetic registry → LightGBM → seed',
      'Git from the first commit; secrets only in environment variables',
    ],
  },
  {
    n: '6', title: 'Security / networking', items: [
      'Supabase Auth (JWT verified server-side) + Postgres RLS: a partner account only ever sees its own areas and uploads',
      'Least privilege: the app logs in as atlas_app, which owns nothing and can only SET ROLE to atlas_user (RLS) or atlas_worker (a fixed set of functions)',
      'Untrusted KMZ: size caps, zip-bomb guard counted while inflating, entry limits, DTD/entity rejection (XXE, billion laughs), vertex and polygon caps',
      'Direct-to-Storage signed uploads to a private bucket; worker endpoint behind a bearer secret with constant-time compare; audit log; CSP, HSTS, frame-deny',
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
          <p className="page-sub">A working prototype of the tools an HBB Market Planning &amp; Insight analyst needs, mapped to the job: market intelligence, network planning support, profitability, data management, performance monitoring and portfolio optimisation.</p>
        </div>
      </div>

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
            <ul style={{ margin: '10px 0 0 18px', display: 'grid', gap: 6 }}>
              {p.items.map((i, k) => <li key={k} style={{ color: 'var(--ink2)' }}>{i}</li>)}
            </ul>
          </section>
        ))}
      </div>

      <section className="card card-pad" style={{ marginBottom: 14 }}>
        <h2 className="card-title">The core check, portable</h2>
        <p className="card-sub" style={{ marginBottom: 10 }}>Which boundaries are clean (no overlap, no intersection)? The same logic in the three engines an analyst is likely to have open.</p>
        <SqlTabs />
      </section>

      <div className="cols-even">
        <section className="card card-pad">
          <h2 className="card-title">Data: what is real, what is not</h2>
          <ul style={{ margin: '10px 0 0 18px', display: 'grid', gap: 6, color: 'var(--ink2)' }}>
            <li><b>Real:</b> {s.buildings?.toLocaleString('en-US')} building footprints (Overture Maps 2026-09, which merges Google Open Buildings, Microsoft and OSM) aggregated into {s.cells.toLocaleString('en-US')} H3 cells; kota boundaries from BPS via geoBoundaries.</li>
            <li><b>Heuristic:</b> home-passes per cell = small footprints (25–500 m²) + half of mid-size footprint ÷ 120 m² × 3 floors.</li>
            <li><b>Synthetic:</b> 4 fictional partners, {s.areas} RFS areas, {s.monthly.toLocaleString('en-US')} months of subscriber, revenue and cost data, competitor presence. The generating process is in scripts/pipeline/02_synth.py so the model can be checked against a known truth.</li>
            <li>No Indosat data of any kind is used.</li>
          </ul>
        </section>
        <section className="card card-pad">
          <h2 className="card-title">What I would do next with real data</h2>
          <ul style={{ margin: '10px 0 0 18px', display: 'grid', gap: 6, color: 'var(--ink2)' }}>
            <li>Replace the home-pass heuristic with the partner home-pass address lists, and calibrate it per kota with BPS household counts.</li>
            <li>Train take-up on real cohorts, with a time split as well as the area split, and add price/package and competitor launch dates as features.</li>
            <li>Run the boundary check in BigQuery GIS on the full national registry; the queue design stays the same.</li>
            <li>Close the loop: post-RFS actuals feed back into the RFS scores every month.</li>
          </ul>
        </section>
      </div>
    </>
  )
}
