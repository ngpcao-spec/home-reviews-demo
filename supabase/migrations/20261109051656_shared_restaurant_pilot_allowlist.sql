-- Empty by default. Only a database operator may record a verified identity.
create table private.shared_restaurant_pilot_places (
 place_id text primary key check(place_id ~ '^ChIJ[[:alnum:]_-]+$'),
 verification_evidence text not null check(length(trim(verification_evidence))>0),
 verified_at timestamptz not null default now()
);
alter table private.shared_restaurant_pilot_places enable row level security;
revoke all on private.shared_restaurant_pilot_places from public,anon,authenticated,service_role;

-- Same transaction lock for admission and configuration changes. No unlocked
-- read-then-start race when the operator removes the pilot.
create function private.shared_pilot_place(p_place text) returns boolean
language plpgsql volatile security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(75302145);
 return public.shared_restaurant_runtime_enabled() and exists(
  select 1 from private.shared_restaurant_pilot_places where place_id=p_place);
end $$;
create function private.shared_pilot_restaurant(p_restaurant uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select private.shared_pilot_place((select place_id from private.shared_restaurants where id=p_restaurant));
$$;
create function private.shared_pilot_establishment(p_establishment uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select private.shared_pilot_place((select place_id from public.establishments where id=p_establishment));
$$;
revoke all on function private.shared_pilot_place(text),private.shared_pilot_restaurant(uuid),private.shared_pilot_establishment(uuid) from public,anon,authenticated;
grant execute on function private.shared_pilot_place(text),private.shared_pilot_restaurant(uuid),private.shared_pilot_establishment(uuid) to service_role;

-- Drain is conservative across the pilot: removal never reopens a legacy paid
-- path while an earlier shared request can still complete or has unknown outcome.
create function private.guard_shared_pilot_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare q text; busy boolean;
begin
 perform pg_advisory_xact_lock(75302145);
 for q in select unnest(array[
  'select exists(select 1 from private.shared_restaurant_operations where state in (''running'',''unknown''))',
  'select exists(select 1 from private.shared_restaurant_collection_jobs where status in (''queued'',''running'',''unknown''))',
  'select exists(select 1 from private.shared_restaurant_initial_sources s left join public.initial_import_jobs j on j.id=s.leader_job where j.status in (''queued'',''running'',''retry'') or (s.result is null and (j.id is null or j.status<>''failed'')))',
  'select exists(select 1 from public.review_sync_jobs where shared_restaurant_id is not null and status in (''queued'',''running'',''retry''))',
  'select exists(select 1 from public.rainminer_menu_jobs j join private.shared_restaurant_establishments l on l.establishment_id=j.establishment_id where j.status in (''queued'',''starting'',''running'',''unknown''))',
  'select exists(select 1 from private.shared_restaurant_analysis_jobs where state in (''reserved'',''unknown''))',
  'select exists(select 1 from public.review_sync_jobs where shared_restaurant_id is not null and status=''dead'' and provider_start_attempted_at is not null and apify_run_id is null and provider_no_run_confirmed_at is null)',
  'select exists(select 1 from public.analysis_jev_batch_runs r join private.shared_restaurant_establishments l on l.establishment_id=r.establishment_id where r.status=''running'')',
  'select exists(select 1 from private.shared_restaurant_jev_keys k join private.shared_jev_analyses a using(identity_sha256) where a.state not in (''ready'',''failed'',''expired''))',
  'select exists(select 1 from private.shared_restaurant_sol_requests s left join public.analysis_jev_batch_runs r on r.id=s.source_run_id where s.receipt is null and (r.id is null or r.status=''running''))'
 ]) loop
  begin execute q into busy;
  exception when undefined_table then
   -- The reduced local SQL harness omits optional report/sync modules.
   busy:=false;
  end;
  if busy then raise exception 'SHARED_PILOT_REQUIRES_DRAIN'; end if;
 end loop;
 if tg_op='TRUNCATE' then return null;end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger shared_pilot_configuration_guard before insert or update or delete
 on private.shared_restaurant_pilot_places for each row execute function private.guard_shared_pilot_change();
create trigger shared_pilot_truncate_guard before truncate
 on private.shared_restaurant_pilot_places for each statement execute function private.guard_shared_pilot_change();
create trigger shared_pilot_runtime_guard before update of enabled
 on private.shared_restaurant_runtime for each row when(old.enabled is distinct from new.enabled)
 execute function private.guard_shared_pilot_change();
revoke all on function private.guard_shared_pilot_change() from public,anon,authenticated,service_role;

-- Patch the existing bodies rather than duplicate the business rules. Exact
-- anchors are asserted, so a changed upstream definition fails the migration.
create function pg_temp.pilot_patch(signature text,old_text text,new_text text) returns void
language plpgsql as $$declare d text; id regprocedure;begin
 id:=to_regprocedure(signature);if id is null then return;end if;
 d:=pg_get_functiondef(id);
 if strpos(d,old_text)=0 then raise exception 'PILOT_PATCH_ANCHOR_MISSING: %',signature;end if;
 execute replace(d,old_text,new_text);
end $$;

select pg_temp.pilot_patch('public.subscribe_verified_shared_restaurant(text,text,text,uuid,uuid,text)',
 'begin','begin if not private.shared_pilot_place(p_place_id) then raise exception ''SHARED_PLACE_NOT_ENABLED'';end if;');
select pg_temp.pilot_patch('public.seed_verified_shared_restaurant(uuid,text,uuid)',
 'begin','begin if not private.shared_pilot_place(p_verified_place_id) then raise exception ''SHARED_PLACE_NOT_ENABLED'';end if;');
select pg_temp.pilot_patch('public.attach_verified_shared_establishment_before_content(uuid,text,uuid)',
 'public.shared_restaurant_runtime_enabled()','private.shared_pilot_place(p_place)');
-- Reduced harness has the pre-content version only.
do $$begin if to_regprocedure('public.attach_verified_shared_establishment_before_content(uuid,text,uuid)') is null then
 perform pg_temp.pilot_patch('public.attach_verified_shared_establishment(uuid,text,uuid)',
 'public.shared_restaurant_runtime_enabled()','private.shared_pilot_place(p_place)');end if;end $$;
select pg_temp.pilot_patch('public.register_shared_restaurant_resolution(jsonb)',
 'public.shared_restaurant_runtime_enabled()','private.shared_pilot_place(p_place->>''placeId'')');
select pg_temp.pilot_patch('public.read_shared_restaurant_resolution(text)',
 'public.shared_restaurant_runtime_enabled()','private.shared_pilot_place(p_place_id)');
select pg_temp.pilot_patch('public.reserve_shared_initial_import(uuid,text)',
 'if restaurant is null then raise exception ''SHARED_VERIFIED_IDENTITY_REQUIRED''; end if;',
 'if restaurant is null or not private.shared_pilot_restaurant(restaurant) then return ''{"state":"legacy"}'';end if;');
select pg_temp.pilot_patch('public.join_available_shared_restaurant(uuid,uuid,text,text,text,jsonb)',
 'if restaurant is null then return null; end if;',
 'if restaurant is null or not private.shared_pilot_restaurant(restaurant) then return null;end if;');

do $$declare f text;begin foreach f in array array[
 'public.shared_restaurant_for_establishment(uuid)',
 'public.read_shared_establishment_menu(uuid,uuid)',
 'public.read_shared_report_publication(uuid,text,uuid)',
 'public.shared_review_projection_bundle(uuid,boolean)',
 'public.read_shared_report_version(uuid,text,uuid,uuid)',
 'public.list_shared_report_versions(uuid,uuid)',
 'public.capture_shared_review_corpus_without_archive(uuid)'
 ] loop perform pg_temp.pilot_patch(f,'public.shared_restaurant_runtime_enabled()',
 'private.shared_pilot_establishment(p_establishment)');end loop;end $$;
select pg_temp.pilot_patch('private.capture_shared_rainminer_menu()',
 'public.shared_restaurant_runtime_enabled()','private.shared_pilot_place(new.place_id)');
select pg_temp.pilot_patch('private.update_shared_subscription_language()',
 'public.shared_restaurant_runtime_enabled()','private.shared_pilot_establishment(new.id)');
select pg_temp.pilot_patch('public.shared_menu_source_valid(uuid,text,boolean)',
 'public.shared_restaurant_runtime_enabled()','private.shared_pilot_place(p_place)');
select pg_temp.pilot_patch('public.enqueue_due_review_sync_jobs(integer)',
 'group by c.restaurant_id,c.language,c.last_success_at',
 'where private.shared_pilot_restaurant(c.restaurant_id) group by c.restaurant_id,c.language,c.last_success_at');
select pg_temp.pilot_patch('public.reserve_incremental_review_sync(uuid,text,jsonb,text)',
 'if j.shared_restaurant_id is not null and not exists',
 'if j.shared_restaurant_id is not null and not private.shared_pilot_restaurant(j.shared_restaurant_id) then return false;end if; if j.shared_restaurant_id is not null and not exists');
select pg_temp.pilot_patch('public.reserve_shared_report_sol(uuid,text)',
 'restaurant is null and public.shared_restaurant_runtime_enabled()',
 'restaurant is null and private.shared_pilot_establishment(r.establishment_id)');
select pg_temp.pilot_patch('public.read_shared_restaurant(uuid,uuid)',
 'where r.id=p_restaurant and','where private.shared_pilot_restaurant(p_restaurant) and r.id=p_restaurant and');
select pg_temp.pilot_patch('public.queue_shared_restaurant_collection(uuid,text)',
 'begin','begin if not private.shared_pilot_restaurant(p_restaurant) then return null;end if;');
select pg_temp.pilot_patch('public.claim_shared_restaurant_collection(uuid)',
 'where j.id=p_job and','where private.shared_pilot_restaurant(j.restaurant_id) and j.id=p_job and');
select pg_temp.pilot_patch('public.reserve_shared_restaurant_analysis(uuid,text,text,text,text)',
 'values(p_restaurant,p_content,p_language,p_model,p_configuration)',
 'select p_restaurant,p_content,p_language,p_model,p_configuration where private.shared_pilot_restaurant(p_restaurant)');
select pg_temp.pilot_patch('public.read_shared_restaurant_analysis(uuid,text,text,text,text)',
 'where restaurant_id=p_restaurant and','where private.shared_pilot_restaurant(p_restaurant) and restaurant_id=p_restaurant and');
select pg_temp.pilot_patch('public.complete_shared_initial_import(uuid,text,jsonb)',
 'select * into strict j from public.initial_import_jobs where id=p_job;',
 'if not private.shared_pilot_place(p_result#>>''{establishment,placeId}'') then return false;end if; select * into strict j from public.initial_import_jobs where id=p_job;');

-- Generic hash-only reservation cannot prove a restaurant. Retire that public
-- entry point, keep the implementation private and bind each key to one identity.
alter function public.reserve_shared_operation(text,uuid) set schema private;
revoke all on function private.reserve_shared_operation(text,uuid) from public,anon,authenticated,service_role;
alter table private.shared_restaurant_operations add column restaurant_id uuid references private.shared_restaurants;
create function public.reserve_scoped_shared_operation(p_key text,p_owner uuid,p_restaurant uuid)
returns jsonb language plpgsql security definer set search_path='' as $$declare answer jsonb;begin
 if not private.shared_pilot_restaurant(p_restaurant) then raise exception 'SHARED_PLACE_NOT_ENABLED';end if;
 answer:=private.reserve_shared_operation(p_key,p_owner);
 if exists(select 1 from private.shared_restaurant_operations where key=p_key and restaurant_id is not null and restaurant_id<>p_restaurant)
 then raise exception 'SHARED_OPERATION_IDENTITY_MISMATCH';end if;
 update private.shared_restaurant_operations set restaurant_id=p_restaurant where key=p_key and restaurant_id is null;
 return answer;
end $$;
revoke all on function public.reserve_scoped_shared_operation(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_scoped_shared_operation(text,uuid,uuid) to service_role;
