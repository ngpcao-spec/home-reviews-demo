-- Existing generations retain Terra; old enqueue clients remain safe during rollout.
alter table public.historical_report_runs add column model text not null default 'gpt-5.6-terra'
  check (length(btrim(model)) > 0);
comment on column public.historical_report_runs.model is 'Immutable model selected at generation creation; never read current env on resume. Reasoning stays low.';

-- Preserve the existing completed Terra output for later A/B comparison, without
-- changing the live report. New workers already persist publication per run.
update public.historical_report_runs r
set snapshot=jsonb_set(r.snapshot,'{publication}',to_jsonb(p)),
    completed_at=coalesce(r.completed_at,p.generated_at)
from public.historical_establishment_reports p
where r.status='completed' and r.generation_id=p.generation_id
  and not (r.snapshot ? 'publication');

create function public.guard_historical_report_model()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.model is distinct from old.model then raise exception 'REPORT_MODEL_IMMUTABLE'; end if;
  return new;
end $$;
create trigger historical_report_model_immutable before update on public.historical_report_runs
for each row execute function public.guard_historical_report_model();
revoke all on function public.guard_historical_report_model() from public,anon,authenticated;

create function public.enqueue_historical_report(p_establishment_id uuid,p_organization_id uuid,p_user_id uuid,p_language text,p_model text)
returns public.historical_report_runs language plpgsql security invoker set search_path='' as $$
declare r public.historical_report_runs;
begin
  if p_language not in ('fr','vi') or not exists(select 1 from public.establishments where id=p_establishment_id and organization_id=p_organization_id)
    or not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role in ('owner','admin','manager'))
    then raise exception 'FORBIDDEN'; end if;
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
    values(p_organization_id,p_establishment_id,p_language,p_user_id,'queued','{}',btrim(p_model)) returning * into r;
  return r;
end $$;


-- Compatibility for old deployed enqueue endpoints; no environment-dependent default.
create or replace function public.enqueue_historical_report(p_establishment_id uuid,p_organization_id uuid,p_user_id uuid,p_language text)
returns public.historical_report_runs language sql security invoker set search_path='' as $$
  select public.enqueue_historical_report(p_establishment_id,p_organization_id,p_user_id,p_language,'gpt-5.6-terra');
$$;
revoke all on function public.enqueue_historical_report(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.enqueue_historical_report(uuid,uuid,uuid,text,text) to service_role;

-- Reject an incorrectly tagged final report rather than silently mixing models.
create function public.guard_historical_report_publication_model()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.historical_report_runs r where r.generation_id=new.generation_id
    and r.model is distinct from new.ai_model) then raise exception 'REPORT_MODEL_MISMATCH'; end if;
  return new;
end $$;
create trigger historical_report_publication_model before insert or update on public.historical_establishment_reports
for each row execute function public.guard_historical_report_publication_model();
revoke all on function public.guard_historical_report_publication_model() from public,anon,authenticated;
