-- atlas_user has no UPDATE on batches: the polygon count is written by the definer function.

create or replace function atlas.enqueue_batch(p_batch uuid) returns int
language plpgsql security definer set search_path = atlas, extensions, pg_temp as $$
declare
  n int; size int; k int := 0;
begin
  if not exists (select 1 from atlas.batches where id = p_batch and uploaded_by = atlas.uid() and status = 'queued'
                 and shards_total = 0) then
    raise exception 'batch not enqueueable' using errcode = '42501';
  end if;
  select count(*) into n from atlas.boundaries where batch_id = p_batch;
  update atlas.batches set polygons = n where id = p_batch;
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
  perform atlas.enqueue_batch(v_id);   -- definer: counts polygons, writes shards, sends messages
  return v_id;
end $$;
