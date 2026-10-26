-- Preparation only: retain the current setting, old bindings, receipts and
-- reports. No dispatch, claim, supplier call or activation in this migration.
-- NOWAIT aborts the whole migration on contention; no partially disabled guard.
begin;
lock table public.report_pipeline_settings,public.report_generation_requests
 in access exclusive mode nowait;

alter table public.report_pipeline_settings
 drop constraint report_pipeline_settings_evidence_selector_version_check,
 add constraint report_pipeline_settings_evidence_selector_version_check check(evidence_selector_version in(
 'jls-direct4-negative-mixed-coverage-v1','sol-evidence-single-negative-source-completion-proposal-v1','sol-evidence-started-source-mixed-completion-v1'));
alter table public.report_generation_requests
 drop constraint report_generation_requests_evidence_selector_version_check,
 add constraint report_generation_requests_evidence_selector_version_check check(evidence_selector_version in(
 'jls-direct4-negative-mixed-coverage-v1','sol-evidence-single-negative-source-completion-proposal-v1','sol-evidence-started-source-mixed-completion-v1'));

create or replace function public.report_evidence_selector_sha(p_version text) returns text
 language sql immutable set search_path='' as $$
 select case p_version
 when 'jls-direct4-negative-mixed-coverage-v1' then '17ea400f28bdc39c7218e2d62c9d9452d137b8e0b4e4891acfacfa8e0237de5e'
 when 'sol-evidence-single-negative-source-completion-proposal-v1' then '3ca3d6002e5cb3a1d29221f6b392bed79514b18af5c29eae7861ab90ed2ce973'
 when 'sol-evidence-started-source-mixed-completion-v1' then 'ed41510685e7897f0f0252fee2a9323140dc49e630d7524a51e706b35d09f1b5'
 end
$$;

-- Metadata backfill only. The table is exclusively locked until commit, and
-- only its immutable-row trigger is suspended for this single update. All
-- source/version/comparison fields and all other triggers remain unchanged.
alter table public.report_generation_requests add column evidence_selector_sha256 text;
do $$begin
 if (select tgenabled from pg_trigger where tgrelid='public.report_generation_requests'::regclass
  and tgname='report_request_immutable') is distinct from 'O' then raise exception 'REPORT_SELECTOR_GUARD_NOT_ENABLED';end if;
end $$;
alter table public.report_generation_requests disable trigger report_request_immutable;
update public.report_generation_requests set evidence_selector_sha256=public.report_evidence_selector_sha(evidence_selector_version);
alter table public.report_generation_requests enable trigger report_request_immutable;
alter table public.report_generation_requests alter column evidence_selector_sha256 set not null,
 add constraint report_generation_requests_evidence_selector_sha256_check check(evidence_selector_sha256 ~ '^[0-9a-f]{64}$');

create or replace function public.pin_report_evidence_selector() returns trigger language plpgsql set search_path='' as $$
begin
 if new.engine='jev_sol_v2' then
  select evidence_selector_version into new.evidence_selector_version
   from public.report_pipeline_settings where id for share;
  if new.evidence_selector_version is null then raise exception 'REPORT_SELECTOR_SETTINGS_MISSING';end if;
 else new.evidence_selector_version='jls-direct4-negative-mixed-coverage-v1';end if;
 new.evidence_selector_sha256=public.report_evidence_selector_sha(new.evidence_selector_version);
 if new.evidence_selector_sha256 is null then raise exception 'REPORT_EVIDENCE_SELECTOR_VERSION_INVALID';end if;
 return new;
end $$;

create function public.report_request_evidence_selector_matches(p_version text,p_sha256 text,p_binding jsonb) returns boolean
 language sql immutable set search_path='' as $$
 select coalesce(p_sha256=public.report_evidence_selector_sha(p_version)
  and public.report_evidence_selector_matches(p_version,p_binding),false)
$$;

-- Strengthen the existing source/request boundaries with the persisted hash.
-- Keep their complete source, authorization, certificate and budget checks.
do $$declare d text;a text;begin
 d=pg_get_functiondef('public.check_parallel_protocol(jsonb)'::regprocedure);
 a='public.report_evidence_selector_matches(q.evidence_selector_version,b#>''{configuration,evidence_selector}'')';
 if position(a in d)=0 then raise exception 'MIXED_SELECTOR_PROTOCOL_ANCHOR_CHANGED';end if;
 execute replace(d,a,'public.report_request_evidence_selector_matches(q.evidence_selector_version,q.evidence_selector_sha256,b#>''{configuration,evidence_selector}'')');

 d=pg_get_functiondef('public.jev_batch_create_current(uuid,jsonb,text)'::regprocedure);
 a='public.report_evidence_selector_matches(q.evidence_selector_version,p_manifest#>''{configuration,selector}'')';
 if position(a in d)=0 then raise exception 'MIXED_SELECTOR_BATCH_ANCHOR_CHANGED';end if;
 execute replace(d,a,'public.report_request_evidence_selector_matches(q.evidence_selector_version,q.evidence_selector_sha256,p_manifest#>''{configuration,selector}'')');
end $$;

revoke all on function public.report_request_evidence_selector_matches(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.report_request_evidence_selector_matches(text,text,jsonb) to service_role;
-- CREATE OR REPLACE above retains the existing service-only ACLs. The current
-- setting, its timestamp, event history and all three implementations survive.
commit;
