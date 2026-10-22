-- Profitability, cohort and portfolio views. Views run with the caller's privileges
-- (security_invoker), so partner users only ever aggregate their own areas.

alter table atlas.batches alter column sliver_m2 set default 500;

insert into atlas.settings (key, value) values
  ('sac_per_gross_add', '650000'),   -- modem + install + sales commission per new subscriber (IDR)
  ('ramp_tau_months', '7')           -- business-plan take-up ramp: bp(age) = bp_m12 * ramp(age) / ramp(11.5)
on conflict (key) do nothing;

create or replace function atlas.ramp(age numeric) returns numeric
language sql immutable as $$ select 1 - exp(-(least(age, 48) + 0.5) / 7.0) $$;

-- one row per area: latest month, run-rate, cumulative economics, plan variance, recommendation
create or replace view atlas.v_area_perf with (security_invoker = true) as
with m as (
  select am.*, a.homepass, a.partner_id,
         am.revenue - am.partner_cost - am.gross_adds * 650000 as margin,
         sum(am.revenue - am.partner_cost - am.gross_adds * 650000) over (partition by am.area_id order by am.month) as cum_margin
  from atlas.area_monthly am join atlas.areas a on a.id = am.area_id
), last as (
  select distinct on (area_id) * from m order by area_id, month desc
), l3 as (
  select area_id, avg(margin) as margin_l3m, avg(revenue) as revenue_l3m,
         avg(gross_adds) as adds_l3m, avg(churned::numeric / nullif(active_subs + churned, 0)) as churn_l3m
  from (select m.*, row_number() over (partition by area_id order by month desc) rn from m) x
  where rn <= 3 group by area_id
), first_pos as (
  select area_id, min(age_m) as payback_age from m where cum_margin >= 0 and age_m > 0 group by area_id
)
select a.id, a.code, a.name, a.partner_id, p.code as partner_code, p.name as partner_name, a.kota, a.rfs_date,
       to_char(date_trunc('quarter', a.rfs_date), 'YYYY"-Q"Q') as cohort,
       a.homepass, last.age_m as age, last.month as as_of, last.active_subs as subs,
       round(last.active_subs::numeric / nullif(a.homepass, 0), 4) as takeup,
       round(a.bp_takeup_m12::numeric * atlas.ramp(last.age_m) / atlas.ramp(11.5), 4) as bp_takeup,
       round((last.active_subs::numeric / nullif(a.homepass, 0)) / nullif(a.bp_takeup_m12::numeric * atlas.ramp(last.age_m) / atlas.ramp(11.5), 0), 3) as vs_plan,
       round(l3.revenue_l3m) as revenue_m, round(l3.margin_l3m) as margin_m, round(l3.churn_l3m, 4) as churn_m,
       round(l3.adds_l3m, 1) as adds_m,
       round(last.cum_margin) as cum_margin,
       fp.payback_age,
       case when fp.payback_age is not null then fp.payback_age
            when l3.margin_l3m > 0 then round(last.age_m + (-last.cum_margin) / l3.margin_l3m)
            else null end as payback_proj,
       a.geom
from atlas.areas a
join atlas.partners p on p.id = a.partner_id
join last on last.area_id = a.id
join l3 on l3.area_id = a.id
left join first_pos fp on fp.area_id = a.id
where a.status = 'active';

-- maintain / optimize / exit with the reason codes that drove it (transparent rules, no ML)
create or replace view atlas.v_portfolio with (security_invoker = true) as
select v.*,
  case
    when v.age < 6 then 'ramping'
    when v.vs_plan < 0.5 and v.age >= 18 and (v.payback_proj is null or v.payback_proj > 60) then 'exit'
    when v.vs_plan < 0.85 or v.payback_proj is null or v.payback_proj > 48 or v.churn_m > 0.025 then 'optimize'
    else 'maintain' end as action,
  array_remove(array[
    case when v.vs_plan < 0.5 then 'takeup_far_below_plan' when v.vs_plan < 0.85 then 'takeup_below_plan' end,
    case when v.payback_proj is null then 'no_payback_at_current_margin' when v.payback_proj > 60 then 'payback_over_5y'
         when v.payback_proj > 48 then 'payback_over_4y' end,
    case when v.churn_m > 0.025 then 'high_churn' end,
    case when v.margin_m <= 0 then 'negative_margin' end
  ], null) as reasons
from atlas.v_area_perf v;

-- average take-up by months-since-RFS for each launch cohort (half-year), plus the plan curve
create or replace view atlas.v_cohort_curve with (security_invoker = true) as
select to_char(a.rfs_date, 'YYYY') || '-H' || (case when extract(month from a.rfs_date) <= 6 then 1 else 2 end) as cohort,
       am.age_m as age,
       round(sum(am.active_subs)::numeric / sum(a.homepass), 4) as takeup,
       count(*) as areas,
       round(avg(a.bp_takeup_m12)::numeric * atlas.ramp(am.age_m) / atlas.ramp(11.5), 4) as bp
from atlas.area_monthly am join atlas.areas a on a.id = am.area_id
group by 1, 2;

grant select on atlas.v_area_perf, atlas.v_portfolio, atlas.v_cohort_curve to atlas_user;
grant execute on function atlas.ramp(numeric) to atlas_user, atlas_worker;
grant select on atlas.settings to atlas_user;
drop policy if exists p_read on atlas.settings;
create policy p_read on atlas.settings for select to atlas_user using (key not like 'secret%');

-- Promote the clean polygons of a finished batch into the home-pass registry (planner only).
create or replace function atlas.promote_batch(p_batch uuid, p_include_touch boolean default true)
returns int language plpgsql security definer set search_path = atlas, extensions, pg_temp as $$
declare n int; v_partner smallint;
begin
  if atlas.my_role() <> 'planner' then raise exception 'planner only' using errcode = '42501'; end if;
  select partner_id into v_partner from atlas.batches where id = p_batch and status = 'done';
  if v_partner is null then raise exception 'batch not done or has no partner' using errcode = '22023'; end if;
  insert into atlas.areas (code, name, partner_id, kota, rfs_date, homepass, bp_takeup_m12, source_batch, geom)
  select left(b.name, 60) || '#' || b.seq, b.name, v_partner,
         coalesce((select c.kota from atlas.h3_cells c where ST_Intersects(c.geom, ST_PointOnSurface(b.geom)) limit 1), 'Unknown'),
         current_date, coalesce(b.homepass_est, 0), 0.15, p_batch, b.geom
  from atlas.boundaries b
  where b.batch_id = p_batch and (b.status = 'clean' or (p_include_touch and b.status = 'touch'))
  on conflict (code) do nothing;
  get diagnostics n = row_count;
  perform atlas.audit('batch.promote', p_batch::text, jsonb_build_object('areas', n));
  return n;
end $$;
revoke all on function atlas.promote_batch(uuid, boolean) from public;
grant execute on function atlas.promote_batch(uuid, boolean) to atlas_user;
