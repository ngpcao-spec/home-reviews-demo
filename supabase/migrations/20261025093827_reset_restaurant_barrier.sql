-- Explicitly authorized complete restaurant reset. Keep only content-free fences.
create table private.restaurant_reset_fence(
 kind text not null, key uuid not null, retired_at timestamptz not null default now(),
 primary key(kind,key)
);
alter table private.restaurant_reset_fence enable row level security;
revoke all on private.restaurant_reset_fence from public,anon,authenticated,service_role;
create table private.restaurant_reset_control(
 id boolean primary key check(id), started_at timestamptz not null default now(), completed_at timestamptz,
 previous_active_jobs bigint[] not null
);
alter table private.restaurant_reset_control enable row level security;
revoke all on private.restaurant_reset_control from public,anon,authenticated,service_role;
insert into private.restaurant_reset_control(id,previous_active_jobs)
select true,array_agg(jobid) from cron.job where active and jobname<>'home-reviews-cron-log-retention-v1';
update public.review_corpus_policy set paused=true,ingestions_paused=true,updated_at=now() where id;
do $$declare j bigint;begin
 foreach j in array (select previous_active_jobs from private.restaurant_reset_control) loop perform cron.alter_job(j,active:=false);end loop;
end $$;
insert into private.restaurant_reset_fence(kind,key) select 'establishment',id from public.establishments;
insert into private.restaurant_reset_fence(kind,key) select 'import',id from public.initial_import_jobs;
insert into private.restaurant_reset_fence(kind,key) select 'request',id from public.report_generation_requests;
insert into private.restaurant_reset_fence(kind,key) select 'source',id from public.historical_report_runs;
insert into private.restaurant_reset_fence(kind,key) select 'batch',id from public.analysis_jev_batch_runs;
create function private.guard_reset_establishment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.restaurant_reset_fence where kind='establishment' and key=new.id) then raise exception 'ESTABLISHMENT_RETIRED_BY_RESET';end if;
 -- An old importer cannot insert a fresh UUID after the reset. Only a fresh,
 -- actually claimed durable import job may create a restaurant.
 if current_setting('role',true)='service_role' and not exists(
  select 1 from public.initial_import_jobs j,private.restaurant_reset_control c
   where j.id=new.initial_import_job_id and j.organization_id=new.organization_id
    and j.created_at>c.started_at and j.status='running' and j.lease_until>now()
    and not exists(select 1 from private.restaurant_reset_fence f where f.kind='import' and f.key=j.id)
 ) then raise exception 'FRESH_IMPORT_JOB_REQUIRED';end if;
 return new;
end $$;
revoke all on function private.guard_reset_establishment() from public,anon,authenticated,service_role;
create trigger restaurant_reset_creation before insert on public.establishments for each row execute function private.guard_reset_establishment();
create function private.guard_reset_import() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.restaurant_reset_fence where kind='import' and key=new.id) then raise exception 'IMPORT_RETIRED_BY_RESET';end if;
 return new;
end $$;
revoke all on function private.guard_reset_import() from public,anon,authenticated,service_role;
create trigger restaurant_reset_import before insert or update on public.initial_import_jobs for each row execute function private.guard_reset_import();
