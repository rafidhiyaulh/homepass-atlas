# HomePass Atlas

A working prototype of the tools an **HBB Market Planning & Insight** analyst uses: keep the home-pass
database clean, find the next RFS areas, track profitability by partner / cluster / cohort, and decide
which areas to maintain, optimize or exit.

**Live:** https://homepass-atlas.vercel.app (one-click demo login: planner, partner, viewer)

> Concept prototype by Muhammad Rafi Dhiyaulhaq. Not an official Indosat product.
> Building footprints are real (Overture Maps); partners, areas, subscribers and competitor presence are synthetic.
> No Indosat data is used.

## Modules

| Module | What it does | Job description line |
|---|---|---|
| **Boundary hygiene** | Upload a partner KMZ; every polygon is checked against the file and the live registry and labelled clean / touch / sliver / overlap / duplicate / self-intersecting. Shared area, double-counted home-passes, KMZ export of clean polygons or clean parts, promote to registry. | Data management (home-pass DB integrity), network planning |
| **RFS desktop study** | H3 grid (res 8) over Jabodetabek with home-passes estimated from 3M building footprints, LightGBM take-up prediction, SHAP drivers, payback; recommends build fiber / HiFi Air (FWA) / hold; KMZ for field survey. | Network planning support, market intelligence |
| **Profitability & cohorts** | Take-up curves by launch cohort vs plan, partner economics (capex vs revenue share), partner × kota variance matrix. | Profitability analysis, performance monitoring |
| **Portfolio actions** | Maintain / optimize / exit from transparent rules, root-cause drivers mapped to levers, Gemini-drafted management note with a numeric grounding check. | Performance monitoring, portfolio optimization |
| **Ask Atlas** | Natural-language question (EN/ID) → Gemini → whitelisted structured filter → parameterised SQL as the user. | Market intelligence, automated reporting |

## Architecture

```
Browser ──HTTPS──> Next.js 16 on Vercel (iad1) ──SET ROLE──> Postgres 17 + PostGIS (Supabase, us-east-1, schema atlas)
                     │  after(): fan-out                       │ pgmq queue atlas_shards (+ DLQ), pg_cron sweep
                     └──> /api/worker × N  <── read / ack ─────┘
                     └──> Gemini (OpenAI-compatible endpoint)
Offline: DuckDB over Overture S3 → H3 aggregates → synthetic registry → LightGBM + TreeSHAP → seed
```

- **Relational DB**: normalised schema with GiST indexes, analytics as `security_invoker` views, versioned migrations (`db/migrations`).
- **APIs + backend**: route handlers under `src/app/api`, PL/pgSQL for pair classification, finalisation and promotion.
- **Distributed systems**: a KMZ becomes shards on pgmq; competing serverless workers with visibility timeouts (at-least-once), idempotent shards, exactly-once finalisation by conditional `UPDATE`, dead-letter queue after 3 attempts, pg_cron re-kick, Postgres-backed rate limits that hold across instances.
- **AI/ML**: LightGBM with GroupKFold by RFS area (no leakage between cells of one launch), TreeSHAP per cell, Gemini for NL → filter and diagnosis → note; JSON-schema output, server re-validation, no model-written SQL, numeric grounding check.
- **Cloud**: Vercel + Supabase (Postgres, Auth, Storage, pgmq, pg_cron, pg_net); functions pinned next to the database.
- **Security**: Supabase Auth + RLS (partners see only their own data), least-privilege DB login role that owns nothing, signed direct-to-Storage uploads, zip-bomb / XXE / entity / size guards on KMZ, worker bearer secret in Vault, audit log, CSP/HSTS.

## Run locally

```bash
npm install
cp .env.example .env.local        # fill in values
node --env-file=.env.local scripts/migrate.mjs
python3 -m venv scripts/.venv && scripts/.venv/bin/pip install duckdb h3 shapely numpy pandas pyarrow lightgbm scikit-learn "psycopg[binary]"
scripts/.venv/bin/python scripts/pipeline/01_buildings_h3.py   # ~8 min, reads Overture from S3
scripts/.venv/bin/python scripts/pipeline/02_synth.py
scripts/.venv/bin/python scripts/pipeline/03_train.py
scripts/.venv/bin/python scripts/pipeline/04_seed.py --reset-batches
scripts/.venv/bin/python scripts/pipeline/05_demo_kmz.py
node --env-file=.env.local scripts/setup-auth.mjs
npm run dev
```

Checks against a running app:

```bash
node --env-file=.env.local scripts/e2e-hygiene.mjs http://localhost:3000 public/samples/NSF_Q4-2026_rollout.kmz planner 1
node --env-file=.env.local scripts/check-rls.mjs http://localhost:3000
node --env-file=.env.local scripts/check-upload-guards.mjs http://localhost:3000
```

## The core check, in plain SQL

See `/architecture` in the app for PostGIS, BigQuery GIS and DuckDB versions of "which boundaries are clean".
The production version is `atlas.classify_pair` in `db/migrations/0003_hygiene.sql`.
