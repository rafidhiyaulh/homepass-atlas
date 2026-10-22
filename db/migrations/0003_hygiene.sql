-- Boundary hygiene pipeline: ingest -> shard -> (parallel workers) classify pairs -> finalize once.
-- Delivery is at-least-once (pgmq visibility timeout), so every step is idempotent.

-- Classify how polygon a relates to polygon b. Returns no row when they do not meet at all.
--   touch     : boundaries meet, interiors do not (shared edge or corner)
--   duplicate : same footprint (symmetric difference under 1% of the smaller area)
--   contains / within : one fully covers the other
--   sliver    : interiors overlap by less than p_sliver_m2 (digitising noise)
--   overlap   : any other interior overlap
create or replace function atlas.classify_pair(a geometry, b geometry, p_sliver_m2 numeric,
  out kind text, out overlap_m2 numeric, out geom geometry)
returns setof record language plpgsql immutable set search_path = atlas, extensions, pg_temp as $$
declare
  rel text; inter geometry; small_m2 numeric; diff_m2 numeric;
begin
  if not ST_Intersects(a, b) then return; end if;
  rel := ST_Relate(a, b);
  if substr(rel, 1, 1) = 'F' then           -- interior/interior empty => boundary contact only
    kind := 'touch'; overlap_m2 := 0; geom := ST_Intersection(ST_Boundary(a), ST_Boundary(b));
    return next; return;
  end if;
  inter := ST_CollectionExtract(ST_Intersection(a, b), 3);
  overlap_m2 := round(ST_Area(inter::geography)::numeric, 1);
  geom := inter;
  small_m2 := least(ST_Area(a::geography), ST_Area(b::geography));
  diff_m2 := ST_Area(ST_SymDifference(a, b)::geography);
  if diff_m2 < 0.01 * small_m2 then kind := 'duplicate';
  elsif ST_Covers(a, b) then kind := 'contains';
  elsif ST_CoveredBy(a, b) then kind := 'within';
  elsif overlap_m2 < p_sliver_m2 then kind := 'sliver';
  else kind := 'overlap';
  end if;
  return next;
end $$;

-- Estimated home-passes inside a geometry, from the H3 building grid (area-weighted).
create or replace function atlas.homepass_in(g geometry) returns int
language sql stable set search_path = atlas, extensions, pg_temp as $$
  select coalesce(round(sum(c.homepass_est * ST_Area(ST_Intersection(c.geom, g)::geography) / nullif(ST_Area(c.geom::geography), 0))), 0)::int
  from atlas.h3_cells c where c.geom && g and ST_Intersects(c.geom, g)
$$;

-- Called by the uploading user (RLS applies to the inserts). features = GeoJSON Feature array
-- already parsed and size-checked by the API. Returns the batch id; same file twice => same batch.
create or replace function atlas.create_batch(p_filename text, p_sha256 text, p_partner smallint,
  p_storage_path text, p_features jsonb, p_sliver_m2 numeric default 50)
returns uuid language plpgsql security invoker set search_path = atlas, extensions, pg_temp as $$
declare
  v_id uuid; n int;
begin
  select id into v_id from atlas.batches where uploaded_by = atlas.uid() and sha256 = p_sha256;
  if v_id is not null then return v_id; end if;

  insert into atlas.batches (partner_id, filename, sha256, storage_path, uploaded_by, sliver_m2)
  values (p_partner, p_filename, p_sha256, p_storage_path, atlas.uid(), p_sliver_m2)
  returning id into v_id;

  -- seq must be dense (1..n): shards are seq ranges
  insert into atlas.boundaries (batch_id, seq, name, folder, partner_id, props, geom_raw, geom, is_valid, valid_reason, area_m2)
  select v_id, row_number() over (order by p.ord)::int,
         left(coalesce(nullif(p.val #>> '{properties,name}', ''), 'Polygon ' || p.ord), 200),
         left(p.val #>> '{properties,folder}', 200),
         p_partner,
         coalesce(p.val -> 'properties', '{}'::jsonb) - 'name' - 'folder',
         p.raw, p.fixed, ST_IsValid(p.raw),
         case when ST_IsValid(p.raw) then null else ST_IsValidReason(p.raw) end,
         round(ST_Area(p.fixed::geography)::numeric, 1)
  from (
    select f.ord, f.val, g.raw, ST_Multi(ST_CollectionExtract(ST_MakeValid(g.raw), 3)) as fixed
    from jsonb_array_elements(p_features) with ordinality as f(val, ord)
    cross join lateral (select ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON(f.val ->> 'geometry')), 4326) as raw) g
  ) p
  where not ST_IsEmpty(p.fixed);

  get diagnostics n = row_count;
  if n = 0 then raise exception 'no polygons in upload' using errcode = '22023'; end if;
  update atlas.batches set polygons = n where id = v_id;
  perform atlas.enqueue_batch(v_id);
  return v_id;
end $$;
grant execute on function atlas.create_batch(text, text, smallint, text, jsonb, numeric) to atlas_user;

-- Split a batch into shards of consecutive seq ranges and put one queue message per shard.
create or replace function atlas.enqueue_batch(p_batch uuid) returns int
language plpgsql security definer set search_path = atlas, extensions, pg_temp as $$
declare
  n int; size int; k int := 0;
begin
  if not exists (select 1 from atlas.batches where id = p_batch and uploaded_by = atlas.uid() and status = 'queued'
                 and shards_total = 0) then
    raise exception 'batch not enqueueable' using errcode = '42501';
  end if;
  select polygons into n from atlas.batches where id = p_batch;
  size := greatest(10, ceil(n / 6.0)::int);           -- ~6 shards so several workers share the work
  for lo in 1..n by size loop
    insert into atlas.batch_shards (batch_id, shard, lo, hi) values (p_batch, k, lo, least(lo + size - 1, n));
    perform pgmq.send('atlas_shards', jsonb_build_object('batch_id', p_batch, 'shard', k, 'lo', lo, 'hi', least(lo + size - 1, n)));
    k := k + 1;
  end loop;
  update atlas.batches set shards_total = k where id = p_batch;
  insert into atlas.audit_log (actor, action, target, detail)
  values (atlas.uid(), 'batch.enqueue', p_batch::text, jsonb_build_object('polygons', n, 'shards', k));
  return k;
end $$;
revoke all on function atlas.enqueue_batch(uuid) from public;

-- ------------------------------------------------------------------ worker-only API
create or replace function atlas.q_read(p_vt int default 60, p_qty int default 1)
returns setof pgmq.message_record language sql security definer set search_path = atlas, pg_temp as $$
  select * from pgmq.read('atlas_shards', p_vt, p_qty)
$$;

create or replace function atlas.q_depth() returns bigint
language sql security definer set search_path = atlas, pg_temp as $$
  select queue_length from pgmq.metrics('atlas_shards')
$$;

-- Process one shard: classify every pair (a in shard, b later in the same batch) and (a, registry area).
-- Re-running a shard deletes its previous output first, so retries are safe.
create or replace function atlas.process_shard(p_msg_id bigint, p_worker text)
returns jsonb language plpgsql security definer set search_path = atlas, extensions, pg_temp as $$
declare
  m jsonb; v_batch uuid; v_shard int; v_lo int; v_hi int; v_sliver numeric; t0 timestamptz := clock_timestamp();
  pairs int; last boolean;
begin
  select message into m from pgmq.q_atlas_shards where msg_id = p_msg_id;
  if m is null then return jsonb_build_object('skipped', 'gone'); end if;   -- already acked by a peer
  v_batch := (m ->> 'batch_id')::uuid; v_shard := (m ->> 'shard')::int; v_lo := (m ->> 'lo')::int; v_hi := (m ->> 'hi')::int;

  update atlas.batches set status = 'processing', started_at = coalesce(started_at, now())
  where id = v_batch and status = 'queued';
  select sliver_m2 into v_sliver from atlas.batches where id = v_batch;

  update atlas.batch_shards set attempts = attempts + 1, worker = p_worker where batch_id = v_batch and shard = v_shard;
  if (select status from atlas.batch_shards where batch_id = v_batch and shard = v_shard) = 'done' then
    perform pgmq.delete('atlas_shards', p_msg_id);
    return jsonb_build_object('skipped', 'done');
  end if;

  delete from atlas.conflicts where batch_id = v_batch and shard = v_shard;

  insert into atlas.conflicts (batch_id, a_id, b_kind, b_id, kind, overlap_m2, geom, shard)
  select v_batch, a.id, 'batch', b.id, k.kind, k.overlap_m2, k.geom, v_shard
  from atlas.boundaries a
  join atlas.boundaries b on b.batch_id = a.batch_id and b.seq > a.seq and a.geom && b.geom
  cross join lateral atlas.classify_pair(a.geom, b.geom, v_sliver) k
  where a.batch_id = v_batch and a.seq between v_lo and v_hi;

  insert into atlas.conflicts (batch_id, a_id, b_kind, b_id, kind, overlap_m2, geom, shard)
  select v_batch, a.id, 'registry', r.id, k.kind, k.overlap_m2, k.geom, v_shard
  from atlas.boundaries a
  join atlas.areas r on r.status = 'active' and a.geom && r.geom
  cross join lateral atlas.classify_pair(a.geom, r.geom, v_sliver) k
  where a.batch_id = v_batch and a.seq between v_lo and v_hi;

  get diagnostics pairs = row_count;

  update atlas.conflicts c set homepass_dup = atlas.homepass_in(c.geom)
  where c.batch_id = v_batch and c.shard = v_shard and c.overlap_m2 > 0;

  update atlas.batch_shards set status = 'done', done_at = now(), last_error = null,
         ms = (extract(epoch from clock_timestamp() - t0) * 1000)::int
  where batch_id = v_batch and shard = v_shard;
  perform pgmq.delete('atlas_shards', p_msg_id);

  -- exactly one worker wins the right to finalize: the conditional update is the lock
  update atlas.batches set status = 'finalizing'
  where id = v_batch and status = 'processing'
    and not exists (select 1 from atlas.batch_shards s where s.batch_id = v_batch and s.status <> 'done')
  returning true into last;
  if last then perform atlas.finalize_batch(v_batch); end if;

  return jsonb_build_object('batch', v_batch, 'shard', v_shard, 'finalized', coalesce(last, false));
end $$;

create or replace function atlas.shard_failed(p_msg_id bigint, p_read_ct int, p_error text, p_max_attempts int default 3)
returns text language plpgsql security definer set search_path = atlas, pg_temp as $$
declare m jsonb; v_batch uuid;
begin
  select message into m from pgmq.q_atlas_shards where msg_id = p_msg_id;
  if m is null then return 'gone'; end if;
  v_batch := (m ->> 'batch_id')::uuid;
  update atlas.batch_shards set last_error = left(p_error, 500)
  where batch_id = v_batch and shard = (m ->> 'shard')::int;
  if p_read_ct < p_max_attempts then return 'retry'; end if;      -- message reappears after its visibility timeout
  perform pgmq.send('atlas_shards_dlq', m || jsonb_build_object('error', left(p_error, 500), 'read_ct', p_read_ct));
  perform pgmq.delete('atlas_shards', p_msg_id);
  update atlas.batch_shards set status = 'dead' where batch_id = v_batch and shard = (m ->> 'shard')::int;
  update atlas.batches set status = 'failed', error = 'shard ' || (m ->> 'shard') || ' failed: ' || left(p_error, 300),
         finished_at = now() where id = v_batch;
  return 'dead';
end $$;

create or replace function atlas.finalize_batch(p_batch uuid) returns void
language plpgsql security definer set search_path = atlas, extensions, pg_temp as $$
begin
  -- every conflict is stored once (a<b); attach it to both sides
  with c as (
    select a_id as id, kind from atlas.conflicts where batch_id = p_batch
    union all
    select b_id, case kind when 'contains' then 'within' when 'within' then 'contains' else kind end
    from atlas.conflicts where batch_id = p_batch and b_kind = 'batch'
  ), agg as (
    select id, array_agg(distinct kind order by kind) as kinds,
           count(*) filter (where kind <> 'touch') as n
    from c group by id
  )
  update atlas.boundaries b set
    kinds = coalesce(agg.kinds, '{}'),
    conflict_count = coalesce(agg.n, 0),
    status = case
      when not b.is_valid then 'invalid'
      when agg.kinds && array['duplicate'] then 'duplicate'
      when agg.kinds && array['overlap', 'contains', 'within'] then 'overlap'
      when agg.kinds && array['sliver'] then 'sliver'
      when agg.kinds && array['touch'] then 'touch'
      else 'clean' end
  from (select id from atlas.boundaries where batch_id = p_batch) ids
  left join agg using (id)
  where b.id = ids.id;

  -- clean part of each polygon = itself minus everything it shares interior with
  update atlas.boundaries b set
    clean_geom = case when o.u is null then b.geom
                      else ST_Multi(ST_CollectionExtract(ST_Difference(b.geom, o.u), 3)) end
  from (
    select x.id, ST_Union(g) as u from atlas.boundaries x
    left join lateral (
      select bb.geom as g from atlas.conflicts c join atlas.boundaries bb on bb.id = case when c.a_id = x.id then c.b_id else c.a_id end
      where c.batch_id = p_batch and c.b_kind = 'batch' and c.kind <> 'touch' and (c.a_id = x.id or c.b_id = x.id)
      union all
      select r.geom from atlas.conflicts c join atlas.areas r on r.id = c.b_id
      where c.batch_id = p_batch and c.b_kind = 'registry' and c.kind <> 'touch' and c.a_id = x.id
    ) og on true
    where x.batch_id = p_batch group by x.id
  ) o
  where b.id = o.id;

  update atlas.boundaries set
    clean_area_m2 = round(ST_Area(clean_geom::geography)::numeric, 1),
    homepass_est = atlas.homepass_in(geom)
  where batch_id = p_batch;

  update atlas.batches b set status = 'done', finished_at = now(), stats = s.stats
  from (
    select jsonb_build_object(
      'by_status', (select jsonb_object_agg(status, n) from (select status, count(*) n from atlas.boundaries where batch_id = p_batch group by 1) t),
      'by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}') from (select kind, count(*) n from atlas.conflicts where batch_id = p_batch group by 1) t),
      'area_m2', (select sum(area_m2) from atlas.boundaries where batch_id = p_batch),
      'clean_area_m2', (select sum(clean_area_m2) from atlas.boundaries where batch_id = p_batch),
      'overlap_m2', (select coalesce(sum(overlap_m2), 0) from atlas.conflicts where batch_id = p_batch and kind <> 'touch'),
      'homepass_est', (select sum(homepass_est) from atlas.boundaries where batch_id = p_batch),
      'homepass_dup', (select coalesce(sum(homepass_dup), 0) from atlas.conflicts where batch_id = p_batch and kind <> 'touch'),
      'registry_hits', (select count(distinct a_id) from atlas.conflicts where batch_id = p_batch and b_kind = 'registry' and kind <> 'touch')
    ) as stats
  ) s
  where b.id = p_batch;
end $$;

create or replace function atlas.worker_run_start(p_worker text, p_trigger text) returns bigint
language sql security definer set search_path = atlas, pg_temp as $$
  insert into atlas.worker_runs (worker, trigger) values (p_worker, p_trigger) returning id
$$;
create or replace function atlas.worker_run_end(p_id bigint, p_processed int, p_failed int) returns void
language sql security definer set search_path = atlas, pg_temp as $$
  update atlas.worker_runs set finished_at = now(), processed = p_processed, failed = p_failed where id = p_id
$$;

revoke all on function atlas.q_read(int, int), atlas.q_depth(), atlas.process_shard(bigint, text),
  atlas.shard_failed(bigint, int, text, int), atlas.finalize_batch(uuid),
  atlas.worker_run_start(text, text), atlas.worker_run_end(bigint, int, int) from public;
grant execute on function atlas.q_read(int, int), atlas.q_depth(), atlas.process_shard(bigint, text),
  atlas.shard_failed(bigint, int, text, int), atlas.worker_run_start(text, text), atlas.worker_run_end(bigint, int, int)
  to atlas_worker;
grant execute on function atlas.q_depth() to atlas_user;
grant execute on function atlas.classify_pair(geometry, geometry, numeric), atlas.homepass_in(geometry) to atlas_user, atlas_worker;

-- ------------------------------------------------------------------ distributed rate limiter + audit
-- Fixed-window counter in Postgres, so the limit holds across every serverless instance.
create or replace function atlas.hit(p_key text, p_max int, p_window_s int) returns boolean
language plpgsql security definer set search_path = atlas, pg_temp as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s); n int;
begin
  insert into atlas.rate_limits (key, window_start, hits) values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = atlas.rate_limits.hits + 1
  returning hits into n;
  if random() < 0.01 then delete from atlas.rate_limits where window_start < now() - interval '1 day'; end if;
  return n <= p_max;
end $$;

create or replace function atlas.audit(p_action text, p_target text, p_detail jsonb default '{}')
returns void language sql security definer set search_path = atlas, pg_temp as $$
  insert into atlas.audit_log (actor, action, target, detail) values (atlas.uid(), p_action, p_target, p_detail)
$$;
revoke all on function atlas.hit(text, int, int), atlas.audit(text, text, jsonb) from public;
grant execute on function atlas.hit(text, int, int), atlas.audit(text, text, jsonb) to atlas_user, atlas_worker;
