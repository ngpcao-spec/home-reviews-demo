-- Durable report orchestration only. Existing checkpoints/reports remain untouched.
alter table public.historical_report_runs
  add column created_at timestamptz,
  add column requested_by uuid references auth.users(id) on delete set null,
  add column started_at timestamptz,
  add column completed_at timestamptz,
  add column total_steps integer,
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column next_retry_at timestamptz,
  add column last_error text,
  add column lease_recovery_count integer not null default 0;
update public.historical_report_runs set created_at=updated_at;
alter table public.historical_report_runs alter column created_at set default now(), alter column created_at set not null;
alter table public.historical_report_runs drop constraint historical_report_runs_status_check;
alter table public.historical_report_runs add constraint historical_report_runs_status_check
  check (status in ('queued','running','retry','completed','failed'));
-- Keep terminal generations for audit, and keep the previous published report while regenerating.
alter table public.historical_report_runs drop constraint historical_report_runs_establishment_id_language_key;
create unique index historical_report_one_active on public.historical_report_runs(organization_id,establishment_id,language)
  where status in ('queued','running','retry');
create unique index historical_report_generation_unique on public.historical_report_runs(generation_id);
create index historical_report_latest on public.historical_report_runs(establishment_id,language,created_at desc);
create index historical_report_available on public.historical_report_runs(next_retry_at,updated_at)
  where status in ('queued','running','retry');

create function public.enqueue_historical_report(p_establishment_id uuid,p_organization_id uuid,p_user_id uuid,p_language text)
returns public.historical_report_runs language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs;
begin
  if p_language not in ('fr','vi') or not exists(select 1 from public.establishments where id=p_establishment_id and organization_id=p_organization_id)
    or not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role in ('owner','admin','manager'))
    then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('historical-enqueue:'||p_establishment_id::text||':'||p_language,0));
  select * into r from public.historical_report_runs where establishment_id=p_establishment_id and language=p_language
    and status in ('queued','running','retry') for update;
  if found then return r; end if;
  select * into r from public.historical_report_runs where establishment_id=p_establishment_id and language=p_language order by created_at desc,id desc limit 1 for update;
  if found and r.status='failed' then
    -- Explicit retry preserves paid checkpoints and the immutable snapshot.
    update public.historical_report_runs set status='queued',attempt_count=0,next_retry_at=null,error_code=null,last_error=null,
      locked_by=null,lease_until=null,updated_at=now() where id=r.id returning * into r;
    return r;
  end if;
  insert into public.historical_report_runs(organization_id,establishment_id,language,requested_by,status,snapshot)
    values(p_organization_id,p_establishment_id,p_language,p_user_id,'queued','{}') returning * into r;
  return r;
end $$;

-- Serialize claims globally so overlapping cron invocations cannot exceed TWO leases.
-- Independent report queue: no changes to initial import or review synchronization.
create function public.claim_historical_report_jobs(p_worker_id uuid,p_limit integer default 2)
returns setof public.historical_report_runs language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs; capacity integer; claimed integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('historical-report-global-capacity',0));
  select greatest(0,2-count(*)::integer) into capacity from public.historical_report_runs
    where status in ('queued','running','retry') and lease_until>now();
  capacity:=least(capacity,greatest(0,least(p_limit,2)));
  for r in select * from public.historical_report_runs
    where status in ('queued','running','retry') and (lease_until is null or lease_until<=now())
      and (next_retry_at is null or next_retry_at<=now()) order by updated_at,id for update skip locked
  loop
    exit when claimed>=capacity;
    if exists(select 1 from public.historical_report_runs where establishment_id=r.establishment_id and lease_until>now() and status in ('queued','running','retry')) then continue; end if;
    if r.attempt_count>=5 then
      update public.historical_report_runs set status='failed',error_code='REPORT_ATTEMPTS_EXHAUSTED',last_error='REPORT_ATTEMPTS_EXHAUSTED',
        locked_by=null,lease_until=null,updated_at=now() where id=r.id returning * into r;
      return next r;
      continue;
    end if;
    update public.historical_report_runs set status='running',locked_by=p_worker_id,lease_until=now()+interval '240 seconds',
      attempt_count=attempt_count+1,started_at=coalesce(started_at,now()),next_retry_at=null,
      lease_recovery_count=lease_recovery_count+case when r.locked_by is not null then 1 else 0 end,
      last_error=case when r.locked_by is not null then 'REPORT_LEASE_RECOVERED' else last_error end,
      token_usage_complete=case when r.locked_by is not null then false else token_usage_complete end,
      updated_at=now() where id=r.id returning * into r;
    claimed:=claimed+1;
    return next r;
  end loop;
end $$;

-- Every checkpoint is fenced by generation, worker, unexpired lease and cursor.
create function public.checkpoint_historical_report_run(p_run_id uuid,p_generation_id uuid,p_worker_id uuid,p_cursor integer,p_values jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs; v public.historical_report_runs;
begin
  select * into r from public.historical_report_runs where id=p_run_id and generation_id=p_generation_id and locked_by=p_worker_id
    and lease_until>now() and status='running' and cursor=p_cursor for update;
  if not found then return false; end if;
  v:=jsonb_populate_record(r,p_values);
  if v.cursor<r.cursor or v.cursor>r.cursor+1 or v.status not in ('running','retry','failed') then raise exception 'REPORT_INVALID_CHECKPOINT'; end if;
  update public.historical_report_runs set snapshot=v.snapshot,findings=v.findings,classifications=v.classifications,cursor=v.cursor,
    input_tokens=v.input_tokens,output_tokens=v.output_tokens,ai_calls=v.ai_calls,rejected_findings_count=v.rejected_findings_count,
    token_usage_complete=v.token_usage_complete,total_steps=v.total_steps,attempt_count=v.attempt_count,
    status=v.status,next_retry_at=v.next_retry_at,last_error=v.last_error,error_code=v.error_code,
    locked_by=v.locked_by,lease_until=v.lease_until,updated_at=now() where id=r.id;
  return true;
end $$;

-- Publish and mark completed atomically, under the same fenced lock. A crash cannot
-- save a report and then repeat the paid narrative step on a later cron tick.
create function public.complete_historical_report_run(p_run_id uuid,p_generation_id uuid,p_worker_id uuid,p_cursor integer,p_report jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs; columns_sql text; updates_sql text; report_json jsonb;
begin
  select * into r from public.historical_report_runs where id=p_run_id and generation_id=p_generation_id and locked_by=p_worker_id
    and lease_until>now() and status='running' and cursor=p_cursor for update;
  if not found then return false; end if;
  if p_report->>'generation_id' is distinct from r.generation_id::text or p_report->>'establishment_id' is distinct from r.establishment_id::text
    or p_report->>'organization_id' is distinct from r.organization_id::text or p_report->>'preferred_language' is distinct from r.language
    or p_report->>'ai_status' is distinct from 'completed' then raise exception 'REPORT_INVALID_PUBLICATION'; end if;
  report_json:=p_report;
  -- Identifiers are quoted; values stay bound. Omitted columns retain defaults on
  -- insert and remain unchanged on update (including earlier-version report fields).
  select string_agg(format('%I',key),','),string_agg(format('%I=excluded.%I',key,key),',') into columns_sql,updates_sql from jsonb_object_keys(report_json) key;
  execute format('insert into public.historical_establishment_reports(%s) select %s from jsonb_populate_record(null::public.historical_establishment_reports,$1) on conflict(establishment_id,preferred_language) do update set %s',columns_sql,columns_sql,updates_sql) using report_json;
  update public.historical_report_runs set status='completed',completed_at=now(),updated_at=now(),locked_by=null,lease_until=null,
    attempt_count=0,next_retry_at=null,error_code=null,last_error=null where id=r.id;
  return true;
end $$;

-- A bounded private RPC for the cron; reuse the existing server-only scheduler
-- secret verifier. No credential value is read by the client or printed in logs.
revoke all on function public.enqueue_historical_report(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.claim_historical_report_jobs(uuid,integer) from public,anon,authenticated;
revoke all on function public.checkpoint_historical_report_run(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
revoke all on function public.complete_historical_report_run(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_historical_report(uuid,uuid,uuid,text),public.claim_historical_report_jobs(uuid,integer),
  public.checkpoint_historical_report_run(uuid,uuid,uuid,integer,jsonb),public.complete_historical_report_run(uuid,uuid,uuid,integer,jsonb) to service_role;

-- Deploy worker before enabling this job. No other cron is changed.
select cron.schedule('home-reviews-historical-report-worker-v1','* * * * *',$cron$
  select net.http_post(
    url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-historical-report-jobs',
    headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',
      (select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
    body:='{}'::jsonb,timeout_milliseconds:=180000);
$cron$);
select cron.alter_job(jobid,active:=false) from cron.job where jobname='home-reviews-historical-report-worker-v1';
