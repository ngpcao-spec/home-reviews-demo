-- Production definition and ACL verified read-only: same six arguments,
-- SECURITY INVOKER, service_role only. Preserve all permissions and orchestration.
-- The sole behavioral change is accepting 5 alongside 3 and 4.
create or replace function public.enqueue_historical_report(p_establishment_id uuid,p_organization_id uuid,p_user_id uuid,p_language text,p_model text,p_analysis_version integer)
returns public.historical_report_runs language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs;
begin
  if p_language not in ('fr','vi') or not exists(select 1 from public.establishments where id=p_establishment_id and organization_id=p_organization_id)
    or not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role in ('owner','admin','manager'))
    then raise exception 'FORBIDDEN'; end if;
  if p_analysis_version is null or p_analysis_version not in (3,4,5) then raise exception 'REPORT_VERSION_INVALID'; end if;
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
