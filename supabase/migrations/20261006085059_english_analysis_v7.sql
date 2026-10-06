-- Non-destructive V7 English analytical input. Preserve all existing rows.
alter table public.review_translations drop constraint review_translations_language_check;
alter table public.review_translations add constraint review_translations_language_check check(language in ('fr','vi','en'));
comment on column public.profiles.preferred_language is 'UI, replies, reports and notifications language (FR/VI); Google review fetch language is independently EN.';
comment on table public.review_translations is 'Google/provider translations in FR, VI or EN; originals remain in reviews.original_text.';
alter table public.jev_benchmark_runs drop constraint jev_benchmark_runs_source_analysis_version_check;
alter table public.jev_benchmark_runs add constraint jev_benchmark_runs_source_analysis_version_check check(source_analysis_version in (6,7));
alter table public.historical_establishment_reports add constraint historical_v7_analytical_totals check(analysis_version<>7 or (sample_reviews_count is not null and analytical_positive_count is not null and analytical_negative_count is not null and analytical_positive_count>=0 and analytical_negative_count>=0 and analytical_positive_count+analytical_negative_count=sample_reviews_count and coalesce(consultant_report->>'version'='7',false)));

create table public.english_translation_backfill_jobs (
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),establishment_id uuid not null references public.establishments(id),requested_by uuid not null references auth.users(id),
  status text not null check(status in ('queued','starting','running','completed','failed')),
  targets jsonb not null,provider_limit integer not null check(provider_limit between 100 and 1000),provider_run_id text,provider_dataset_id text,provider_requests integer not null default 0,
  result jsonb,error_code text,lease_token text,lease_until timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),completed_at timestamptz,deadline_at timestamptz not null default now()+interval '30 minutes'
);
create unique index english_backfill_one_active on public.english_translation_backfill_jobs(establishment_id) where status in ('queued','starting','running');
create index english_backfill_org_created on public.english_translation_backfill_jobs(organization_id,created_at desc);
alter table public.english_translation_backfill_jobs enable row level security;
revoke all on public.english_translation_backfill_jobs from public,anon,authenticated;
grant select on public.english_translation_backfill_jobs to authenticated;
grant all on public.english_translation_backfill_jobs to service_role;
create policy english_backfill_read on public.english_translation_backfill_jobs for select to authenticated using ((select private.has_org_role(organization_id,array['owner','admin','manager'])));
create function public.claim_english_translation_backfill_jobs(p_worker text) returns setof public.english_translation_backfill_jobs language plpgsql security invoker set search_path='' as $$
begin
  -- An uncertain paid start is not automatically repeated after a crash.
  update public.english_translation_backfill_jobs set status='failed',error_code='ENGLISH_APIFY_START_UNCONFIRMED',completed_at=now(),lease_token=null,lease_until=null where status='starting' and lease_until<now();
  return query with candidate as (select id from public.english_translation_backfill_jobs where status in ('queued','running') and (lease_until is null or lease_until<now()) order by created_at for update skip locked limit 1)
    update public.english_translation_backfill_jobs j set lease_token=p_worker,lease_until=now()+interval '4 minutes',updated_at=now() from candidate c where j.id=c.id returning j.*;
end $$;
revoke all on function public.claim_english_translation_backfill_jobs(text) from public,anon,authenticated;
grant execute on function public.claim_english_translation_backfill_jobs(text) to service_role;
-- This cron ONLY processes jobs created by an authenticated manual click.
select cron.schedule('home-reviews-english-backfill-worker-v1','* * * * *',$cron$
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-review-english-backfill-jobs',headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),body:='{}'::jsonb,timeout_milliseconds:=180000)
 where exists(select 1 from public.english_translation_backfill_jobs where status in ('queued','running','starting'));
$cron$);
create or replace function public.enqueue_historical_report(p_establishment_id uuid,p_organization_id uuid,p_user_id uuid,p_language text,p_model text,p_analysis_version integer)
returns public.historical_report_runs language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs;
begin
  if p_language not in ('fr','vi') or not exists(select 1 from public.establishments where id=p_establishment_id and organization_id=p_organization_id)
    or not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role in ('owner','admin','manager'))
    then raise exception 'FORBIDDEN'; end if;
  if p_analysis_version is null or p_analysis_version not in (3,4,5,6,7) then raise exception 'REPORT_VERSION_INVALID'; end if;
  if p_model is null or btrim(p_model)='' then raise exception 'REPORT_MODEL_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('historical-enqueue:'||p_establishment_id::text||':'||p_language,0));
  select * into r from public.historical_report_runs where establishment_id=p_establishment_id and language=p_language
    and status in ('queued','running','retry') for update;
  if found then return r; end if;
  select * into r from public.historical_report_runs where establishment_id=p_establishment_id and language=p_language order by created_at desc,id desc limit 1 for update;
  if found and r.status='failed' and coalesce((r.snapshot->>'analysis_version')::integer,3)=p_analysis_version then
    -- Explicit retry preserves paid checkpoints and the immutable snapshot.
    update public.historical_report_runs set status='queued',attempt_count=0,next_retry_at=null,error_code=null,last_error=null,
      locked_by=null,lease_until=null,updated_at=now() where id=r.id returning * into r;
    return r;
  end if;
  insert into public.historical_report_runs(organization_id,establishment_id,language,requested_by,status,snapshot,model)
    values(p_organization_id,p_establishment_id,p_language,p_user_id,'queued',jsonb_build_object('analysis_version',p_analysis_version),btrim(p_model)) returning * into r;
  return r;
end $$;
