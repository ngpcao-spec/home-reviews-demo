-- Staged only: no activation, wake, task reservation, provider call or report
-- replacement. Existing requests and the global default stay on legacy coverage.
alter table public.report_pipeline_settings add column evidence_selector_version text not null
 default 'jls-direct4-negative-mixed-coverage-v1'
 check(evidence_selector_version in('jls-direct4-negative-mixed-coverage-v1','sol-evidence-single-negative-source-completion-proposal-v1'));
alter table public.report_generation_requests add column evidence_selector_version text not null
 default 'jls-direct4-negative-mixed-coverage-v1'
 check(evidence_selector_version in('jls-direct4-negative-mixed-coverage-v1','sol-evidence-single-negative-source-completion-proposal-v1'));

create function public.report_evidence_selector_sha(p_version text) returns text
 language sql immutable set search_path='' as $$
 select case p_version
 when 'jls-direct4-negative-mixed-coverage-v1' then '17ea400f28bdc39c7218e2d62c9d9452d137b8e0b4e4891acfacfa8e0237de5e'
 when 'sol-evidence-single-negative-source-completion-proposal-v1' then '3ca3d6002e5cb3a1d29221f6b392bed79514b18af5c29eae7861ab90ed2ce973'
 end
$$;
create function public.report_evidence_selector_matches(p_version text,p_binding jsonb) returns boolean
 language sql immutable set search_path='' as $$
 select coalesce(public.report_evidence_selector_sha(p_version) is not null and (
  p_binding is null and p_version='jls-direct4-negative-mixed-coverage-v1'
  or p_binding=jsonb_build_object('version',p_version,'sha256',public.report_evidence_selector_sha(p_version))),false)
$$;

-- This runs in the enqueue transaction, under the same settings row lock as
-- the route switch. An explicit client value cannot override the server choice.
create function public.pin_report_evidence_selector() returns trigger language plpgsql set search_path='' as $$
begin
 if new.engine='jev_sol_v2' then
  select evidence_selector_version into new.evidence_selector_version
   from public.report_pipeline_settings where id for share;
  if new.evidence_selector_version is null then raise exception 'REPORT_SELECTOR_SETTINGS_MISSING';end if;
 else new.evidence_selector_version='jls-direct4-negative-mixed-coverage-v1';end if;
 return new;
end $$;
create trigger pin_report_evidence_selector before insert on public.report_generation_requests
 for each row execute function public.pin_report_evidence_selector();
-- The existing report_request_immutable trigger compares the complete row,
-- except comparison_id. It already makes the new selector column immutable.

create function public.set_current_report_evidence_selector(p_version text,p_reason text) returns text
 language plpgsql set search_path='' as $$
declare s public.report_pipeline_settings;begin
 if current_user<>'service_role' or public.report_evidence_selector_sha(p_version) is null
  or p_reason is null or length(btrim(p_reason))<12 then raise exception 'FORBIDDEN';end if;
 select * into s from public.report_pipeline_settings where id for update;
 if s.id is null then raise exception 'REPORT_SELECTOR_SETTINGS_MISSING';end if;
 if s.evidence_selector_version=p_version then return p_version;end if;
 update public.report_pipeline_settings set evidence_selector_version=p_version,updated_at=now(),
  reason='Selector '||p_version||': '||p_reason where id;
 insert into public.report_pipeline_events(engine,jev_transport,reason)
  values(s.engine,s.jev_transport,'Selector '||s.evidence_selector_version||' -> '||p_version||': '||p_reason);
 return p_version;
end $$;

-- Keep all source, access, immutable certificate and provider budget checks.
-- Add a request-bound check to the existing protocol validator, rather than
-- replacing its source validation or accepting any recomputed hash.
do $$declare d text;a text;begin
 d=pg_get_functiondef('public.check_parallel_protocol(jsonb)'::regprocedure);
 a='and q.language=b->>''language'')';
 if position(a in d)=0 then raise exception 'REPORT_SELECTOR_PROTOCOL_ANCHOR_CHANGED';end if;
 execute replace(d,a,'and q.language=b->>''language''
  and public.report_evidence_selector_matches(q.evidence_selector_version,b#>''{configuration,evidence_selector}''))');

 d=pg_get_functiondef('public.jev_batch_create_current(uuid,jsonb,text)'::regprocedure);
 a='if q.id is null or q.engine<>''jev_sol_v2'' or q.jev_transport<>''batch_initial_v1'' then raise exception ''CURRENT_BATCH_REQUEST_REQUIRED'';end if;';
 if position(a in d)=0 then raise exception 'REPORT_SELECTOR_BATCH_ANCHOR_CHANGED';end if;
 execute replace(d,a,a||'
 if not public.report_evidence_selector_matches(q.evidence_selector_version,p_manifest#>''{configuration,selector}'')
 or q.evidence_selector_version<>''jls-direct4-negative-mixed-coverage-v1'' and
  p_manifest#>''{template,evidence_selector}'' is distinct from p_manifest#>''{configuration,selector}''
 or p_manifest#>''{template,evidence_selector}'' is not null and
  p_manifest#>''{template,evidence_selector}'' is distinct from p_manifest#>''{configuration,selector}''
 then raise exception ''CURRENT_BATCH_SELECTOR_CHANGED'';end if;');

 d=pg_get_functiondef('public.jev_batch_save_draft(uuid,jsonb,text)'::regprocedure);
 a='if r.draft is not null then return r.draft_sha256=p_sha;end if;';
 if position(a in d)=0 then raise exception 'REPORT_SELECTOR_DRAFT_ANCHOR_CHANGED';end if;
 execute replace(d,a,a||'
 if r.template?''evidence_selector'' then
  if not public.report_evidence_selector_matches(r.template#>>''{evidence_selector,version}'',r.template->''evidence_selector'')
   or p_body->''evidence_selector'' is distinct from r.template->''evidence_selector''
   or p_body#>>''{selection,version}'' is distinct from r.template#>>''{evidence_selector,version}''
   then raise exception ''BATCH_EVIDENCE_SELECTOR_CHANGED'';end if;
 elsif p_body->''evidence_selector'' is not null or p_body#>>''{selection,version}'' is distinct from ''jls-direct4-negative-mixed-coverage-v1''
  then raise exception ''BATCH_EVIDENCE_SELECTOR_CHANGED'';end if;');
end $$;

revoke all on function public.report_evidence_selector_sha(text),public.report_evidence_selector_matches(text,jsonb),
 public.pin_report_evidence_selector(),public.set_current_report_evidence_selector(text,text) from public,anon,authenticated;
grant execute on function public.report_evidence_selector_sha(text),public.report_evidence_selector_matches(text,jsonb),
 public.pin_report_evidence_selector(),public.set_current_report_evidence_selector(text,text) to service_role;
