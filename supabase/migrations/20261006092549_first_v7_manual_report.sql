-- Explicit experimental first V7 launch. Never invoked by cron or migrations.
create function public.enqueue_first_v7_report(p_establishment_id uuid,p_organization_id uuid,p_user_id uuid,p_language text)
returns public.historical_report_runs language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs;
begin
  if p_language not in ('fr','vi') or not exists(select 1 from public.establishments where id=p_establishment_id and organization_id=p_organization_id)
    or not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role in ('owner','admin','manager'))
    then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('historical-enqueue:'||p_establishment_id::text||':'||p_language,0));
  select * into r from public.historical_report_runs where establishment_id=p_establishment_id and language=p_language and status in ('queued','running','retry') for update;
  if found then
    if (r.snapshot->>'analysis_version') is distinct from '7' then raise exception 'REPORT_OTHER_VERSION_RUNNING'; end if;
    return r;
  end if;
  -- Completed first reports are idempotent even when a response is lost.
  select * into r from public.historical_report_runs where establishment_id=p_establishment_id and language=p_language and snapshot->>'analysis_version'='7' and status='completed' order by created_at desc,id desc limit 1;
  if found then return r; end if;
  if not exists(select 1 from public.reviews where establishment_id=p_establishment_id and organization_id=p_organization_id)
    or exists(select 1 from public.reviews rv where rv.establishment_id=p_establishment_id and rv.organization_id=p_organization_id and btrim(coalesce(rv.original_text,''))<>''
      and split_part(replace(lower(btrim(coalesce(rv.original_language,''))),'_','-'),'-',1)<>'en'
      and not exists(select 1 from public.review_translations t where t.review_id=rv.id and t.language='en' and btrim(t.translated_text)<>''))
    then raise exception 'ENGLISH_COVERAGE_REQUIRED'; end if;
  return public.enqueue_historical_report(p_establishment_id,p_organization_id,p_user_id,p_language,'gpt-6.1-sol',7);
end $$;
revoke all on function public.enqueue_first_v7_report(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.enqueue_first_v7_report(uuid,uuid,uuid,text) to service_role;
