-- Row-level security. The app sets `request.jwt.claims` (verified Supabase Auth JWT) and then
-- `SET LOCAL ROLE atlas_user` inside every request transaction; these policies are the only thing
-- deciding what a user can see. Partners see only their own areas and uploads.

create or replace function atlas.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

create or replace function atlas.me() returns atlas.profiles
language sql stable security definer set search_path = atlas, pg_temp as $$
  select * from atlas.profiles where user_id = atlas.uid()
$$;

create or replace function atlas.my_role() returns text
language sql stable as $$ select (atlas.me()).role $$;

create or replace function atlas.my_partner() returns smallint
language sql stable as $$ select (atlas.me()).partner_id $$;

-- may the current user see rows owned by partner p? (planners/viewers: all; partners: own)
create or replace function atlas.sees_partner(p smallint) returns boolean
language sql stable as $$
  select case atlas.my_role()
    when 'planner' then true
    when 'viewer'  then true
    when 'partner' then p is not distinct from atlas.my_partner()
    else false end
$$;

grant execute on function atlas.uid(), atlas.me(), atlas.my_role(), atlas.my_partner(), atlas.sees_partner(smallint)
  to atlas_user, atlas_worker;

alter table atlas.partners      enable row level security;
alter table atlas.profiles      enable row level security;
alter table atlas.h3_cells      enable row level security;
alter table atlas.areas         enable row level security;
alter table atlas.area_monthly  enable row level security;
alter table atlas.batches       enable row level security;
alter table atlas.batch_shards  enable row level security;
alter table atlas.boundaries    enable row level security;
alter table atlas.conflicts     enable row level security;
alter table atlas.worker_runs   enable row level security;
alter table atlas.audit_log     enable row level security;
alter table atlas.rate_limits   enable row level security;
alter table atlas.model_runs    enable row level security;
alter table atlas.settings      enable row level security;

grant select on atlas.partners, atlas.profiles, atlas.h3_cells, atlas.areas, atlas.area_monthly,
  atlas.batches, atlas.batch_shards, atlas.boundaries, atlas.conflicts, atlas.worker_runs, atlas.model_runs
  to atlas_user;
grant insert on atlas.batches, atlas.boundaries to atlas_user;
grant usage on sequence atlas.boundaries_id_seq to atlas_user;

drop policy if exists p_read on atlas.partners;
create policy p_read on atlas.partners for select to atlas_user using (atlas.my_role() is not null);

drop policy if exists p_self on atlas.profiles;
create policy p_self on atlas.profiles for select to atlas_user
  using (user_id = atlas.uid() or atlas.my_role() = 'planner');

-- market grid is not partner-specific, but who covers a cell is: partners get the cell without the owner
drop policy if exists p_read on atlas.h3_cells;
create policy p_read on atlas.h3_cells for select to atlas_user using (atlas.my_role() is not null);

drop policy if exists p_read on atlas.areas;
create policy p_read on atlas.areas for select to atlas_user using (atlas.sees_partner(partner_id));

drop policy if exists p_read on atlas.area_monthly;
create policy p_read on atlas.area_monthly for select to atlas_user
  using (exists (select 1 from atlas.areas a where a.id = area_id and atlas.sees_partner(a.partner_id)));

drop policy if exists p_read on atlas.batches;
create policy p_read on atlas.batches for select to atlas_user
  using (atlas.my_role() in ('planner', 'viewer') or (partner_id = atlas.my_partner() and atlas.my_role() = 'partner'));
drop policy if exists p_insert on atlas.batches;
create policy p_insert on atlas.batches for insert to atlas_user
  with check (uploaded_by = atlas.uid() and (
    atlas.my_role() = 'planner' or (atlas.my_role() = 'partner' and partner_id = atlas.my_partner())));

drop policy if exists p_read on atlas.batch_shards;
create policy p_read on atlas.batch_shards for select to atlas_user
  using (exists (select 1 from atlas.batches b where b.id = batch_id));

drop policy if exists p_read on atlas.boundaries;
create policy p_read on atlas.boundaries for select to atlas_user
  using (exists (select 1 from atlas.batches b where b.id = batch_id));
drop policy if exists p_insert on atlas.boundaries;
create policy p_insert on atlas.boundaries for insert to atlas_user
  with check (exists (select 1 from atlas.batches b where b.id = batch_id and b.uploaded_by = atlas.uid() and b.status = 'queued'));

drop policy if exists p_read on atlas.conflicts;
create policy p_read on atlas.conflicts for select to atlas_user
  using (exists (select 1 from atlas.batches b where b.id = batch_id));

drop policy if exists p_read on atlas.worker_runs;
create policy p_read on atlas.worker_runs for select to atlas_user using (atlas.my_role() = 'planner');

drop policy if exists p_read on atlas.model_runs;
create policy p_read on atlas.model_runs for select to atlas_user using (atlas.my_role() is not null);
-- audit_log, rate_limits, settings: no policies => invisible to atlas_user; written via definer functions
