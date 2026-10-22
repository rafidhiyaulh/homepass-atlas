-- HomePass Atlas: core schema. Everything lives in schema `atlas` so it can share a Supabase project
-- with other apps without touching their objects. The web app logs in as `atlas_app`, which owns nothing
-- and can only SET ROLE to `atlas_user` (end-user requests, RLS enforced) or `atlas_worker` (queue workers,
-- may only execute a fixed set of SECURITY DEFINER functions).

create extension if not exists postgis with schema extensions;
create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create schema if not exists atlas;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'atlas_user') then create role atlas_user nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'atlas_worker') then create role atlas_worker nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'atlas_app') then create role atlas_app login noinherit; end if;
end $$;
grant atlas_user, atlas_worker to atlas_app;
grant usage on schema atlas, extensions to atlas_user, atlas_worker;

-- ---------------------------------------------------------------- reference data
create table if not exists atlas.partners (
  id            smallint primary key,
  code          text not null unique,
  name          text not null,
  color         text not null,
  model         text not null check (model in ('capex_share', 'revenue_share')),
  upfront_per_hp numeric not null,      -- IDR paid per home-pass at RFS
  fee_per_sub    numeric not null,      -- IDR per active subscriber per month
  note          text
);

create table if not exists atlas.profiles (
  user_id     uuid primary key,          -- auth.users.id
  email       text not null,
  role        text not null check (role in ('planner', 'partner', 'viewer')),
  partner_id  smallint references atlas.partners(id),
  display_name text not null,
  check (role <> 'partner' or partner_id is not null)
);

-- H3 resolution-8 cells (~0.74 km2) with public building aggregates + model outputs
create table if not exists atlas.h3_cells (
  h3              text primary key,
  kota            text not null,
  geom            geometry(Polygon, 4326) not null,
  centroid        geometry(Point, 4326) not null,
  buildings       int not null,
  homepass_est    int not null,
  footprint_m2    numeric not null,
  mdu_share       real not null,         -- share of footprint in 500-5000 m2 buildings
  dist_cbd_km     real not null,
  competitors     smallint not null,     -- synthetic: competing fiber brands present
  covered_area_id int,
  pred_takeup_m12 real,
  pred_takeup_m24 real,
  drivers         jsonb,                 -- per-feature SHAP contributions (logit scale)
  rfs_score       real,
  rfs_reco        text check (rfs_reco in ('build', 'fwa', 'hold', 'covered')),
  payback_months  real
);
create index if not exists h3_cells_geom_gix on atlas.h3_cells using gist (geom);

-- ---------------------------------------------------------------- home-pass registry (RFS areas)
create table if not exists atlas.areas (
  id            serial primary key,
  code          text not null unique,
  name          text not null,
  partner_id    smallint not null references atlas.partners(id),
  kota          text not null,
  rfs_date      date not null,
  homepass      int not null,
  bp_takeup_m12 real not null,           -- business-plan target at month 12
  status        text not null default 'active' check (status in ('active', 'exited')),
  source_batch  uuid,
  geom          geometry(MultiPolygon, 4326) not null
);
create index if not exists areas_geom_gix on atlas.areas using gist (geom);
create index if not exists areas_partner_idx on atlas.areas (partner_id);

create table if not exists atlas.area_monthly (
  area_id      int not null references atlas.areas(id) on delete cascade,
  month        date not null,
  age_m        smallint not null,          -- months since RFS
  active_subs  int not null,
  gross_adds   int not null,
  churned      int not null,
  revenue      numeric not null,           -- IDR
  partner_cost numeric not null,           -- IDR
  primary key (area_id, month)
);

-- ---------------------------------------------------------------- boundary hygiene (KMZ checks)
create table if not exists atlas.batches (
  id            uuid primary key default gen_random_uuid(),
  partner_id    smallint references atlas.partners(id),
  filename      text not null,
  sha256        text not null,
  storage_path  text,
  uploaded_by   uuid not null,
  sliver_m2     numeric not null default 50,
  status        text not null default 'queued'
                check (status in ('queued', 'processing', 'finalizing', 'done', 'failed')),
  polygons      int not null default 0,
  shards_total  int not null default 0,
  stats         jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  unique (uploaded_by, sha256)              -- re-uploading the same file is idempotent
);

create table if not exists atlas.batch_shards (
  batch_id   uuid not null references atlas.batches(id) on delete cascade,
  shard      int not null,
  lo         int not null,
  hi         int not null,
  status     text not null default 'pending' check (status in ('pending', 'done', 'dead')),
  attempts   int not null default 0,
  worker     text,
  last_error text,
  done_at    timestamptz,
  ms         int,
  primary key (batch_id, shard)
);

create table if not exists atlas.boundaries (
  id            bigserial primary key,
  batch_id      uuid not null references atlas.batches(id) on delete cascade,
  seq           int not null,
  name          text not null,
  folder        text,
  partner_id    smallint references atlas.partners(id),
  props         jsonb not null default '{}',
  geom_raw      geometry not null,                    -- exactly as uploaded (may be invalid)
  geom          geometry(MultiPolygon, 4326) not null, -- ST_MakeValid'd polygonal part
  is_valid      boolean not null,
  valid_reason  text,
  area_m2       numeric not null,
  homepass_est  int,
  status        text check (status in ('clean', 'touch', 'sliver', 'overlap', 'duplicate', 'invalid')),
  kinds         text[],
  conflict_count int,
  clean_geom    geometry(MultiPolygon, 4326),
  clean_area_m2 numeric,
  unique (batch_id, seq)
);
create index if not exists boundaries_geom_gix on atlas.boundaries using gist (geom);
create index if not exists boundaries_batch_idx on atlas.boundaries (batch_id, seq);

create table if not exists atlas.conflicts (
  batch_id   uuid not null references atlas.batches(id) on delete cascade,
  a_id       bigint not null references atlas.boundaries(id) on delete cascade,
  b_kind     text not null check (b_kind in ('batch', 'registry')),
  b_id       bigint not null,
  kind       text not null check (kind in ('duplicate', 'contains', 'within', 'overlap', 'sliver', 'touch')),
  overlap_m2 numeric not null,
  homepass_dup int,
  geom       geometry,
  shard      int not null,
  primary key (batch_id, a_id, b_kind, b_id)
);
create index if not exists conflicts_b_idx on atlas.conflicts (batch_id, b_kind, b_id);

-- ---------------------------------------------------------------- ops tables
create table if not exists atlas.worker_runs (
  id         bigserial primary key,
  worker     text not null,
  trigger    text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  processed  int not null default 0,
  failed     int not null default 0
);

create table if not exists atlas.audit_log (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  actor  uuid,
  action text not null,
  target text,
  detail jsonb
);

create table if not exists atlas.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (key, window_start)
);

create table if not exists atlas.model_runs (
  id         serial primary key,
  created_at timestamptz not null default now(),
  model      text not null,
  target     text not null,
  metrics    jsonb not null,
  importance jsonb not null,
  notes      text
);

create table if not exists atlas.settings (
  key   text primary key,
  value text not null
);

select pgmq.create('atlas_shards') where not exists (select 1 from pgmq.list_queues() where queue_name = 'atlas_shards');
select pgmq.create('atlas_shards_dlq') where not exists (select 1 from pgmq.list_queues() where queue_name = 'atlas_shards_dlq');
