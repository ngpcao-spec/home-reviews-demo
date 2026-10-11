-- Free deterministic evidence experiment only; no provider calls, jobs or report changes.
create table public.analysis_jev_pilot_evidence_audits(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 snapshot_id uuid not null references public.analysis_jev_pilot_snapshots(id),report_id uuid not null references public.analysis_jev_pilot_jobs(id),
 selection_version text not null check(selection_version='pilot-evidence-explicit-v2'),verifier_version text not null check(verifier_version='explicit-evidence-rules-v1'),
 rule_sha256 text not null check(rule_sha256~'^[a-f0-9]{64}$'),source_sha256 text not null,report_sha256 text not null,prediction_source_sha256 text not null,
 result_sha256 text not null check(result_sha256~'^[a-f0-9]{64}$'),result jsonb not null,
 verification_type text not null default 'deterministic_rule_check' check(verification_type='deterministic_rule_check'),
 human_validated boolean not null default false check(not human_validated),ai_verified boolean not null default false check(not ai_verified),
 new_paid_calls integer not null default 0 check(new_paid_calls=0),production_enabled boolean not null default false check(not production_enabled),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(snapshot_id,report_id,selection_version,rule_sha256,prediction_source_sha256)
);
create index pilot_evidence_org on public.analysis_jev_pilot_evidence_audits(organization_id);
create index pilot_evidence_report on public.analysis_jev_pilot_evidence_audits(report_id);
create index pilot_evidence_actor on public.analysis_jev_pilot_evidence_audits(created_by);
alter table public.analysis_jev_pilot_evidence_audits enable row level security;
revoke all on public.analysis_jev_pilot_evidence_audits from anon,authenticated;
grant select on public.analysis_jev_pilot_evidence_audits to authenticated;
grant all on public.analysis_jev_pilot_evidence_audits to service_role;
create policy pilot_evidence_read on public.analysis_jev_pilot_evidence_audits for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=analysis_jev_pilot_evidence_audits.organization_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','manager')));
create function public.pilot_evidence_immutable() returns trigger language plpgsql security invoker set search_path='' as $$begin raise exception 'EVIDENCE_AUDIT_IMMUTABLE';end $$;
create trigger pilot_evidence_immutable before update or delete on public.analysis_jev_pilot_evidence_audits for each row execute function public.pilot_evidence_immutable();
create function public.save_pilot_evidence_audit(p_user uuid,p_snapshot uuid,p_report uuid,p_result jsonb,p_result_sha text) returns uuid language plpgsql security invoker set search_path='' as $$
declare snap public.analysis_jev_pilot_snapshots;job public.analysis_jev_pilot_jobs;aid uuid;begin
 select * into snap from public.analysis_jev_pilot_snapshots where id=p_snapshot;
 select * into job from public.analysis_jev_pilot_jobs where id=p_report;
 if snap.id is null or job.id is null or job.snapshot_id<>snap.id or job.organization_id<>snap.organization_id or job.stage<>'sol' or job.status<>'completed' or not exists(select 1 from public.organization_members where organization_id=snap.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if p_result->>'version' is distinct from 'pilot-evidence-explicit-v2' or p_result->>'verifier' is distinct from 'explicit-evidence-rules-v1' or p_result->>'source_sha256' is distinct from snap.source_sha256 or p_result->>'snapshot_id' is distinct from snap.id::text or p_result->>'report_id' is distinct from job.id::text or p_result->>'counts_unchanged' is distinct from 'true' or p_result->>'independent_human_validation' is distinct from 'false' or p_result->>'new_paid_calls' is distinct from '0' or p_result->>'production_enabled' is distinct from 'false' then raise exception 'EVIDENCE_SOURCE_CHANGED';end if;
 if p_result_sha<>encode(extensions.digest(public.jev_economy_canonical(p_result),'sha256'),'hex') or p_result->>'report_sha256'<>encode(extensions.digest(public.jev_economy_canonical(jsonb_build_object('input_context',job.input_context,'result',job.result)),'sha256'),'hex') or p_result->'source_context' is distinct from job.input_context->'narrative_input' then raise exception 'EVIDENCE_HASH_CHANGED';end if;
 if p_result->>'prediction_source_sha256'<>encode(extensions.digest(public.jev_economy_canonical(p_result->'source_fingerprints'),'sha256'),'hex') or exists(select 1 from jsonb_array_elements(p_result->'source_fingerprints') f left join public.analysis_jev_review_cache c on c.id=(f->>'cache_id')::uuid where c.id is null or c.organization_id<>snap.organization_id or c.establishment_id<>snap.establishment_id or c.status<>'completed' or c.processed_at>job.created_at or f->>'sha256'<>encode(extensions.digest(public.jev_economy_canonical(jsonb_build_object('cache_key',c.cache_key,'response',c.response,'theme_results',c.theme_results,'served_model',c.served_model)),'sha256'),'hex')) then raise exception 'EVIDENCE_PREDICTION_CHANGED';end if;
 if jsonb_array_length(p_result->'selected')>8 or jsonb_array_length(p_result->'checks')<>(p_result->'summary'->>'checked')::int or exists(select 1 from jsonb_array_elements(p_result->'selected') chosen where chosen->>'status'<>'supported_by_rule' or not(p_result->'checks' @> jsonb_build_array(chosen))) then raise exception 'EVIDENCE_SELECTION_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_snapshot::text||':'||p_report::text||':'||(p_result->>'rule_sha256'),0));
 select id into aid from public.analysis_jev_pilot_evidence_audits where snapshot_id=p_snapshot and report_id=p_report and rule_sha256=p_result->>'rule_sha256' and prediction_source_sha256=p_result->>'prediction_source_sha256';if found then return aid;end if;
 insert into public.analysis_jev_pilot_evidence_audits(organization_id,snapshot_id,report_id,selection_version,verifier_version,rule_sha256,source_sha256,report_sha256,prediction_source_sha256,result_sha256,result,created_by) values(snap.organization_id,snap.id,job.id,p_result->>'version',p_result->>'verifier',p_result->>'rule_sha256',snap.source_sha256,p_result->>'report_sha256',p_result->>'prediction_source_sha256',p_result_sha,p_result,p_user) returning id into aid;return aid;
end $$;
revoke all on function public.pilot_evidence_immutable(),public.save_pilot_evidence_audit(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_pilot_evidence_audit(uuid,uuid,uuid,jsonb,text) to service_role;
