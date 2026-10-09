-- Existing correction rows remain unchanged. The table is private and read-only to this resolver.
create table if not exists public.analysis_review_english_translation_overrides (
 review_id uuid primary key references public.reviews(id) on delete restrict,
 original_text_sha256 text not null check(original_text_sha256 ~ '^[a-f0-9]{64}$'),
 provider_translation_sha256 text not null check(provider_translation_sha256 ~ '^[a-f0-9]{64}$'),
 correction_language text not null default 'en' check(correction_language='en'),
 corrected_english_text text not null check(btrim(corrected_english_text)<>''),
 corrected_english_sha256 text not null check(corrected_english_sha256 ~ '^[a-f0-9]{64}$'),
 error_type text not null check(error_type in ('sentiment_reversal','hallucinated_currency','menu_item_as_location')),
 evidence_fr text not null,source text not null default 'chatgpt_gpt_6_manual_audit' check(source='chatgpt_gpt_6_manual_audit'),
 status text not null default 'candidate_for_future_analysis' check(status='candidate_for_future_analysis'),
 benchmark_policy text not null default 'do_not_change_frozen_v9_v11_inputs' check(benchmark_policy='do_not_change_frozen_v9_v11_inputs'),
 created_at timestamptz not null default now()
);
alter table public.analysis_review_english_translation_overrides enable row level security;
revoke all on public.analysis_review_english_translation_overrides from anon,authenticated;
grant select on public.analysis_review_english_translation_overrides to service_role;
create function public.read_analysis_english_translation_overrides(p_organization uuid,p_review_ids uuid[],p_as_of timestamptz)
returns setof public.analysis_review_english_translation_overrides language sql stable security invoker set search_path='' as $$
 select o.* from public.analysis_review_english_translation_overrides o join public.reviews r on r.id=o.review_id
 where r.organization_id=p_organization and o.review_id=any(p_review_ids) and o.created_at<=p_as_of order by o.review_id;
$$;
revoke all on function public.read_analysis_english_translation_overrides(uuid,uuid[],timestamptz) from public,anon,authenticated;
grant execute on function public.read_analysis_english_translation_overrides(uuid,uuid[],timestamptz) to service_role;
-- Tag only newly INSERTED English-input runs. Existing runs, retries and frozen inputs retain their old policy.
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
    values(p_organization_id,p_establishment_id,p_language,p_user_id,'queued',(jsonb_build_object('analysis_version',p_analysis_version)||case when p_analysis_version>=7 then jsonb_build_object('english_translation_override_policy','verified_english_translation_overrides_v1') else '{}'::jsonb end),btrim(p_model)) returning * into r;
  return r;
end $$;

revoke all on function public.enqueue_historical_report(uuid,uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.enqueue_historical_report(uuid,uuid,uuid,text,text,integer) to service_role;
