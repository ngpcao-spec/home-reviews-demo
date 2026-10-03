-- Pin narrative semantics at creation, leaving all existing runs and reports untouched.
create function public.enqueue_historical_report(p_establishment_id uuid,p_organization_id uuid,p_user_id uuid,p_language text,p_model text,p_analysis_version integer)
returns public.historical_report_runs language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs;
begin
  if p_language not in ('fr','vi') or not exists(select 1 from public.establishments where id=p_establishment_id and organization_id=p_organization_id)
    or not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role in ('owner','admin','manager'))
    then raise exception 'FORBIDDEN'; end if;
  if p_analysis_version is null or p_analysis_version not in (3,4) then raise exception 'REPORT_VERSION_INVALID'; end if;
  if p_model is null or btrim(p_model)='' then raise exception 'REPORT_MODEL_REQUIRED'; end if;
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
  insert into public.historical_report_runs(organization_id,establishment_id,language,requested_by,status,snapshot,model)
    values(p_organization_id,p_establishment_id,p_language,p_user_id,'queued',jsonb_build_object('analysis_version',p_analysis_version),btrim(p_model)) returning * into r;
  return r;
end $$;

create or replace function public.enqueue_historical_report(p_establishment_id uuid,p_organization_id uuid,p_user_id uuid,p_language text,p_model text)
returns public.historical_report_runs language sql security invoker set search_path='' as $$
  select public.enqueue_historical_report(p_establishment_id,p_organization_id,p_user_id,p_language,p_model,3);
$$;
revoke all on function public.enqueue_historical_report(uuid,uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.enqueue_historical_report(uuid,uuid,uuid,text,text,integer) to service_role;

-- Apply the existing count invariant to V4 as well; no existing row is rewritten.
alter table public.historical_establishment_reports add constraint historical_v4_analytical_totals check (
  analysis_version <> 4 or (
    sample_reviews_count is not null and analytical_positive_count is not null and analytical_negative_count is not null
    and analytical_positive_count >= 0 and analytical_negative_count >= 0
    and analytical_positive_count + analytical_negative_count = sample_reviews_count
    and consultant_report is not null and coalesce(consultant_report->>'version' = '4',false)
  )
);
