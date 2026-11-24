-- FUTURE OPERATOR ACTION ONLY. Running this file without all session settings
-- deliberately fails. It must never be invoked by deployment, Cron or clients.
begin;
set local lock_timeout='5s';
do $$
declare e public.establishments; c private.rainminer_menu_config; test_job uuid;
begin
 if current_setting('home.rainminer_first_test_authorized',true) is distinct from 'yes' then
  raise exception 'EXPLICIT_FIRST_TEST_AUTHORIZATION_REQUIRED';
 end if;
 perform pg_advisory_xact_lock(75302143);
 select * into strict c from private.rainminer_menu_config where singleton;
 if c.automatic_enabled or c.launches_enabled or c.first_test_job_id is not null then raise exception 'MENU_TEST_ALREADY_ARMED'; end if;
 if c.budget_limit_usd<>5 or c.per_run_limit_usd<>0.5 then raise exception 'MENU_TEST_LIMITS_MISMATCH'; end if;
 if nullif(btrim(current_setting('home.rainminer_billing_evidence',true)),'') is null then raise exception 'MENU_COST_CEILING_UNVERIFIED'; end if;
 if exists(select 1 from public.rainminer_menu_jobs where status in ('starting','running','unknown')) then raise exception 'MENU_ACTIVE_RUN_REQUIRES_RECONCILIATION'; end if;
 select * into strict e from public.establishments
  where id=current_setting('home.rainminer_test_establishment',true)::uuid and active;
 if coalesce(e.place_id,'')!~'^ChIJ[A-Za-z0-9_-]+$' then raise exception 'MENU_PLACE_ID_REQUIRED'; end if;
 if not exists(select 1 from public.organization_members where organization_id=e.organization_id
  and user_id=current_setting('home.rainminer_test_user',true)::uuid and role in ('owner','admin','manager')) then raise exception 'MENU_FORBIDDEN'; end if;
 if exists(select 1 from public.rainminer_menu_jobs where place_id=e.place_id and status='queued') then raise exception 'MENU_EXISTING_QUEUED_REQUEST'; end if;
 if exists(select 1 from public.rainminer_menu_jobs where place_id=e.place_id and status='completed'
  and result->>'placeId'=e.place_id and jsonb_typeof(result->'references')='array')
  or private.rainminer_shared_saved(e.place_id) is not null then raise exception 'MENU_ALREADY_AVAILABLE_REUSE_IT'; end if;
 if private.rainminer_budget_used()+0.5>5 then raise exception 'MENU_BUDGET_LIMIT'; end if;
 test_job:=private.enqueue_rainminer_target(e.id,current_setting('home.rainminer_test_request',true)::uuid,false);
 update private.rainminer_menu_config set first_test_job_id=test_job,
  billing_ceiling_evidence=current_setting('home.rainminer_billing_evidence'),configured_at=clock_timestamp(),
  launches_enabled=true,automatic_enabled=false where singleton;
end$$;
commit;
select first_test_job_id,automatic_enabled,launches_enabled,budget_limit_usd,per_run_limit_usd
 from private.rainminer_menu_config where singleton;
