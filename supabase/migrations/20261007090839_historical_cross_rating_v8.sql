create or replace function public.enqueue_historical_report(p_establishment_id uuid,p_organization_id uuid,p_user_id uuid,p_language text,p_model text,p_analysis_version integer)
returns public.historical_report_runs language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs;
begin
  if p_language not in ('fr','vi') or not exists(select 1 from public.establishments where id=p_establishment_id and organization_id=p_organization_id)
    or not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role in ('owner','admin','manager'))
    then raise exception 'FORBIDDEN'; end if;
  if p_analysis_version is null or p_analysis_version not in (3,4,5,6,7,8) then raise exception 'REPORT_VERSION_INVALID'; end if;
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
-- Only future V8 publications require the additional deterministic output.
alter table public.historical_establishment_reports add constraint historical_v8_analytical_totals check(analysis_version<>8 or (
 sample_reviews_count is not null and analytical_positive_count is not null and analytical_negative_count is not null
 and analytical_positive_count>=0 and analytical_negative_count>=0 and analytical_positive_count+analytical_negative_count=sample_reviews_count
 and coalesce(consultant_report->>'version'='8',false)
 and coalesce(jsonb_typeof(consultant_report->'cross_rating_analysis')='object',false)
 and coalesce((consultant_report->'cross_rating_analysis'->>'total_reviews')::integer=sample_reviews_count,false)));

-- Explicit first-test enqueue only. No migration/cron invocation, no old run updates.
create function public.enqueue_first_v8_report(p_establishment_id uuid,p_organization_id uuid,p_user_id uuid,p_language text,p_source_generation_id uuid)
returns public.historical_report_runs language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs;
begin
 if p_language not in ('fr','vi') or not exists(select 1 from public.establishments where id=p_establishment_id and organization_id=p_organization_id)
  or not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if not exists(select 1 from public.historical_report_runs where generation_id=p_source_generation_id and establishment_id=p_establishment_id and organization_id=p_organization_id and status='completed' and snapshot->>'analysis_version'='7' and coalesce((snapshot->'base'->'analysis_input_stats'->>'english_analysis_coverage_percent')::numeric,0)=100) then raise exception 'REPORT_V8_SOURCE_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('historical-enqueue:'||p_establishment_id::text||':'||p_language,0));
 select * into r from public.historical_report_runs where establishment_id=p_establishment_id and language=p_language and status in ('queued','running','retry') for update;
 if found then if (r.snapshot->>'analysis_version') is distinct from '8' then raise exception 'REPORT_OTHER_VERSION_RUNNING';end if;return r;end if;
 select * into r from public.historical_report_runs where establishment_id=p_establishment_id and language=p_language and snapshot->>'analysis_version'='8' and status='completed' order by created_at desc,id desc limit 1;
 if found then return r;end if;
 if not exists(select 1 from public.reviews where establishment_id=p_establishment_id and organization_id=p_organization_id)
  or exists(select 1 from public.reviews rv where rv.establishment_id=p_establishment_id and rv.organization_id=p_organization_id and btrim(coalesce(rv.original_text,''))<>''
   and split_part(replace(lower(btrim(coalesce(rv.original_language,''))),'_','-'),'-',1)<>'en'
   and not exists(select 1 from public.review_translations tr where tr.review_id=rv.id and tr.language='en' and btrim(tr.translated_text)<>'')) then raise exception 'ENGLISH_COVERAGE_REQUIRED';end if;
 return public.enqueue_historical_report(p_establishment_id,p_organization_id,p_user_id,p_language,'gpt-6.1-sol',8);
end $$;
revoke all on function public.enqueue_first_v8_report(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_first_v8_report(uuid,uuid,uuid,text,uuid) to service_role;
