-- jls-chill-immutable-source-guard-v1. Initial compilation/save still executes
-- the full canonical-hash verifier. Completed cache rows and sealed artifacts
-- cannot change afterwards. Runtime retains the worker's complete body hashes,
-- checks the stored immutable manifests and live identities, and atomically
-- reserves the attempt. No permissions, RLS, consent or call limits change.
create or replace function public.check_jls_chill_v21_immutable_sources(p_body jsonb)
returns boolean language plpgsql stable set search_path='' set jit='off' as $fn$
declare p public.analysis_jls_restaurant_protocols;r public.analysis_jls_restaurant_runs;
 x jsonb;t public.analysis_jls_restaurant_tasks;a public.analysis_jls_restaurant_artifacts;
 c public.analysis_jev_review_cache;cfg public.analysis_jev_economy_configurations;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 -- Fail closed if an immutability guard relied upon by this fast path is disabled.
 if (select count(*) from pg_catalog.pg_trigger tr join pg_catalog.pg_proc f on f.oid=tr.tgfoid
 where tr.tgrelid in ('public.analysis_jls_restaurant_artifacts'::regclass,'public.analysis_jls_restaurant_protocols'::regclass,
 'public.analysis_jls_snapshot_preparations'::regclass,'public.analysis_jls_sol_ready_artifacts'::regclass)
 and f.proname='pilot_evidence_immutable' and tr.tgenabled in ('O','A') and not tr.tgisinternal)<>4
 or not exists(select 1 from pg_catalog.pg_trigger tr join pg_catalog.pg_proc f on f.oid=tr.tgfoid
 where tr.tgrelid='public.analysis_jev_review_cache'::regclass and f.proname='jev_economy_guard'
 and tr.tgenabled in ('O','A') and not tr.tgisinternal) then return false;end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=(p_body->>'source_protocol_id')::uuid;
 select * into r from public.analysis_jls_restaurant_runs where id=(p_body->>'source_run_id')::uuid;
 if p.id is null or r.id is null or r.protocol_id<>p.id or r.organization_id<>p.organization_id or r.status<>'blocked'
 or p.establishment_id<>'a9a6ec1c-cbb3-4e39-a498-86f2e68bd4b8' or p.body->>'version'<>'jls-historical-snapshot-v2-vi-v1'
 or p.sha256<>p_body->>'source_protocol_sha256' or not public.check_jls_snapshot_v2_source(p.body)
 or jsonb_array_length(p_body->'source_tasks')<>28 or jsonb_array_length(p_body->'decisions')<>32
 or jsonb_array_length(p_body->'plan'->'cache_fingerprints')<>80
 or not exists(select 1 from public.analysis_jls_restaurant_artifacts d where d.run_id=r.id and d.organization_id=p.organization_id and d.kind='luna_decisions'
 and d.sha256=p_body->>'source_decisions_artifact_sha256' and d.body->>'decisions_sha256'=p_body->>'decisions_sha256') then return false;end if;
 for x in select value from jsonb_array_elements(p_body->'source_tasks') loop
 select * into t from public.analysis_jls_restaurant_tasks where id=(x->>'task_id')::uuid;
 select * into a from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='task:'||t.id;
 if t.id is null or t.run_id<>r.id or t.organization_id<>p.organization_id or t.phase<>'luna'
 or t.status<>'completed' or t.request_count<>1 or t.review_id::text<>x->>'review_id' or t.request_sha256<>x->>'request_sha256'
 or a.organization_id is distinct from p.organization_id or a.sha256 is distinct from x->>'artifact_sha256'
 or a.body->>'response_sha256' is distinct from x->>'response_sha256'
 or not exists(select 1 from jsonb_array_elements(p_body->'plan'->'luna_groups') g where g.value->>'review_id'=t.review_id::text
 and g.value->>'request_sha256'=t.request_sha256 and g.value->'payload'=t.request) then return false;end if;
 end loop;
 select * into cfg from public.analysis_jev_economy_configurations where id='v12_economy_1pass_v1';
 if cfg.id is null then return false;end if;
 for x in select value from jsonb_array_elements(p_body->'plan'->'cache_fingerprints') loop
 select * into c from public.analysis_jev_review_cache where id=(x->>'cache_id')::uuid;
 if c.id is null or c.organization_id<>p.organization_id or c.establishment_id<>p.establishment_id or c.status<>'completed'
 or c.review_id::text<>x->>'review_id' or c.analysis_text_sha256<>x->>'text_sha256'
 or c.configuration_id<>cfg.id or c.instruction_version<>cfg.config->>'instruction_version'
 or c.instruction_sha256<>cfg.instruction_sha256 or c.threshold_version<>cfg.config->>'threshold_version'
 or c.threshold_sha256<>cfg.threshold_sha256 or c.requested_model<>cfg.config->>'requested_model'
 or c.expected_served_model<>'jev-1.13.0' or c.served_model<>c.expected_served_model
 or not exists(select 1 from jsonb_array_elements(p.body->'snapshot'->'source'->'reviews') v where v.value->>'id'=c.review_id::text
 and v.value->>'analysis_text_sha256'=c.analysis_text_sha256 and v.value->>'analysis_language'='en')
 then return false;end if;
 end loop;return true;
end $fn$;
revoke all on function public.check_jls_chill_v21_immutable_sources(jsonb) from public,anon,authenticated;
grant execute on function public.check_jls_chill_v21_immutable_sources(jsonb) to service_role;

create or replace function public.check_jls_contract_v2_sources(p_protocol uuid) returns boolean language plpgsql stable set search_path='' set jit='off' as $fn$
declare p public.analysis_jls_contract_v2_protocols;a public.analysis_jls_sol_ready_artifacts;r public.analysis_jls_snapshot_preparations;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_contract_v2_protocols where id=p_protocol;
 if p.body->>'version' is distinct from 'jls-chill-targeted-v2.1-delegated-vi-v1' then return public.check_jls_contract_v2_garden_sources(p_protocol);end if;
 select * into a from public.analysis_jls_sol_ready_artifacts where id=p.source_artifact_id;
 select * into r from public.analysis_jls_snapshot_preparations where id=p.source_snapshot_archive_id;
 return p.id is not null and a.organization_id=p.organization_id and r.organization_id=p.organization_id
 and a.sha256=p.body->>'source_artifact_sha256' and r.sha256=p.body->>'source_archive_sha256'
 and r.body->>'source_result_sha256'=p.body->>'source_result_sha256'
 and r.body->>'source_decisions_sha256'=a.body->>'decisions_sha256'
 and r.body->>'source_artifact_sha256'=a.sha256 and r.body->>'source_protocol_id'=p.body->>'source_protocol_id'
 and public.check_jls_chill_v21_immutable_sources(a.body)
 and exists(select 1 from public.organization_members m where m.organization_id=p.organization_id and m.user_id=p.authority_user_id and m.role in('owner','admin','manager'));
end $fn$;
