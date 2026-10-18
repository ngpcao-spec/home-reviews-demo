-- A typed source FK for the Chill archive; Garden's existing FK and data stay.
alter table public.analysis_jls_contract_v2_protocols alter column source_archive_id drop not null;
alter table public.analysis_jls_contract_v2_protocols add column source_snapshot_archive_id uuid references public.analysis_jls_snapshot_preparations(id);
alter table public.analysis_jls_contract_v2_protocols add constraint jls_contract_v2_one_archive check ((source_archive_id is null) <> (source_snapshot_archive_id is null));

CREATE OR REPLACE FUNCTION public.check_jls_contract_v2_garden_sources(p_protocol uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare p public.analysis_jls_contract_v2_protocols;a public.analysis_jls_sol_ready_artifacts;r public.analysis_jls_recommendation_reviews;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_contract_v2_protocols where id=p_protocol;
 select * into a from public.analysis_jls_sol_ready_artifacts where id=p.source_artifact_id;
 select * into r from public.analysis_jls_recommendation_reviews where id=p.source_archive_id;
 return p.id is not null and a.organization_id=p.organization_id and r.organization_id=p.organization_id
 and a.sha256=p.body->>'source_artifact_sha256' and r.sha256=p.body->>'source_archive_sha256'
 and r.body->>'original_result_sha256'=p.body->>'source_result_sha256'
 and public.check_jls_sol_ready_sources(a.body)
 and exists(select 1 from public.organization_members m where m.organization_id=p.organization_id and m.user_id=p.authority_user_id and m.role in('owner','admin','manager'));
end $function$;


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
 and public.check_jls_sol_ready_sources(a.body)
 and exists(select 1 from public.organization_members m where m.organization_id=p.organization_id and m.user_id=p.authority_user_id and m.role in('owner','admin','manager'));
end $fn$;

CREATE OR REPLACE FUNCTION public.save_jls_chill_v21_protocol(p_body jsonb, p_sha text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a public.analysis_jls_sol_ready_artifacts;r public.analysis_jls_snapshot_preparations;s public.analysis_jls_restaurant_protocols;
 b jsonb;e jsonb;candidate jsonb;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into a from public.analysis_jls_sol_ready_artifacts where id=(p_body->>'source_artifact_id')::uuid;
 select * into r from public.analysis_jls_snapshot_preparations where id=(p_body->>'source_archive_id')::uuid;
 select * into s from public.analysis_jls_restaurant_protocols where id=(p_body->>'source_protocol_id')::uuid;
 candidate=r.body->'candidates'->0;
 if a.id is null or r.id is null or s.id is null or a.organization_id<>s.organization_id or r.organization_id<>s.organization_id
 or p_sha is distinct from public.jls_restaurant_hash(p_body) or p_body->>'version' is distinct from 'jls-chill-targeted-v2.1-delegated-vi-v1'
 or p_body->>'language' is distinct from 'vi' or p_body->>'preparation_is_not_spending_authorization' is distinct from 'true'
 or p_body->>'organization_id' is distinct from s.organization_id::text or p_body->>'authority_user_id' is distinct from s.authority_user_id::text
 or p_body->>'establishment_id' is distinct from 'a9a6ec1c-cbb3-4e39-a498-86f2e68bd4b8'
 or p_body->>'source_artifact_sha256' is distinct from a.sha256 or p_body->>'source_archive_sha256' is distinct from r.sha256
 or p_body->>'source_protocol_sha256' is distinct from s.sha256 or p_body->>'snapshot_sha256' is distinct from public.jls_restaurant_hash(s.body->'snapshot')
 or p_body->>'source_run_id' is distinct from r.body->>'source_run_id' or p_body->>'source_result_sha256' is distinct from r.body->>'source_result_sha256'
 or p_body->>'source_decisions_sha256' is distinct from a.body->>'decisions_sha256' or jsonb_array_length(a.body->'plan'->'cache_fingerprints')<>80
 or p_body->>'configuration_sha256' is distinct from public.jls_restaurant_hash(p_body->'configuration')
 or not (p_body->'configuration' @> '{"max_jev_calls":0,"max_luna_calls":1,"max_questions":1,"max_sol_calls":1,"apify_calls":0,"automatic_retry":false,"provider_client_retries":0,"production_enabled":false,"language":"vi","no_monetary_estimate":true}')
 or p_body->>'plan_sha256' is distinct from public.jls_restaurant_hash(p_body->'plan')
 or p_body->'plan'->>'statistics_sha256' is distinct from a.body->'plan'->>'statistics_sha256'
 or p_body->'plan'->'statistics' is distinct from a.body->'plan'->'statistics'
 or p_body->'plan'->>'config_sha256' is distinct from a.body->'plan'->>'config_sha256'
 or p_body->>'reused_decisions_sha256' is distinct from public.jls_restaurant_hash(p_body->'reused_decisions')
 or jsonb_array_length(p_body->'reused_decisions')<>31 or jsonb_array_length(p_body->'plan'->'selected')<>32
 or (select count(distinct value->>'evidence_id') from jsonb_array_elements(p_body->'plan'->'selected'))<>32
 or exists(select 1 from jsonb_array_elements(p_body->'reused_decisions') d where not (a.body->'decisions' @> jsonb_build_array(d.value)) or d.value->>'evidence_id' in(p_body->>'removed_evidence_id',p_body->>'candidate_evidence_id'))
 or p_body->>'candidate_evidence_id' is distinct from candidate->>'evidence_id'
 or exists(select 1 from jsonb_array_elements(p_body->'plan'->'selected') x where
 not(a.body->'plan'->'selected' @> jsonb_build_array(x.value)) and x.value is distinct from ((candidate-array['luna_verdict','status'])||'{"status":"sol_candidate"}'))
 or (p_body->'plan'->'selected' @> jsonb_build_array(jsonb_build_object('evidence_id',p_body->>'removed_evidence_id')))
 or p_body->'luna_group'->'evidence_ids' is distinct from jsonb_build_array(p_body->>'candidate_evidence_id')
 or p_body->'luna_group'->'payload'->>'model' is distinct from 'gpt-6-luna' or jsonb_array_length(p_body->'luna_group'->'payload'->'questions')<>1
 or p_body->'luna_group'->>'request_sha256' is distinct from public.jls_restaurant_hash((p_body->>'luna_request_json')::jsonb)
 or p_body->'luna_group'->'payload' is distinct from (p_body->>'luna_request_json')::jsonb
 or p_body->>'luna_request_raw_sha256' is distinct from encode(extensions.digest(p_body->>'luna_request_json','sha256'),'hex')
 or jsonb_array_length(p_body->'branches')<>3 or (select count(distinct value->>'assumption') from jsonb_array_elements(p_body->'branches'))<>3
 or p_body->>'code_provenance' !~ '^[a-f0-9]{40}$' or not public.check_jls_sol_ready_sources(a.body)
 then raise exception 'JLS_V2_PREPARATION_CHANGED';end if;

 if r.id is distinct from 'ff28e270-f330-453c-85ea-a1860425bbe5'::uuid
 or r.body->>'version' is distinct from 'jls-reservation-beverage-review-v2.1'
 or p_body->>'candidate_evidence_id' is distinct from 'ea98b7c1ce48de265026fb9d94ab82e8aff3653f32b2dc3478f7e4687a0ff97e'
 or p_body->>'removed_evidence_id' is distinct from '7f9809ab307f386b177babd74a39a547dbaf1fecc46354808da6a36755d811e8'
 or candidate->>'theme_key' is distinct from 'wait_time' or candidate->>'polarity' is distinct from 'negative'
 or candidate->>'luna_verdict' is not null or candidate->>'requires_new_luna_verification' is distinct from 'true'
 or jsonb_array_length(s.body->'snapshot'->'source'->'reviews')<>100 or jsonb_array_length(s.body->'english_review_ids')<>80
 or p_body->'plan'->'config' is distinct from a.body->'plan'->'config'
 or p_body->'plan'->'cache_fingerprints' is distinct from a.body->'plan'->'cache_fingerprints'
 or p_body->'plan'->'luna_groups' is distinct from (a.body->'plan'->'luna_groups')||jsonb_build_array(p_body->'luna_group')
 or p_body->'plan'->>'max_luna_calls' is distinct from '1'
 or p_body->'plan'->>'dossier_sha256' is distinct from public.jls_restaurant_hash(p_body->'plan'->'selected')
 or p_body->'plan'->>'luna_manifest_sha256' is distinct from public.jls_restaurant_hash(p_body->'plan'->'luna_groups')
 or p_body->'luna_group'->>'questions_sha256' is distinct from public.jls_restaurant_hash(p_body->'luna_group'->'payload'->'questions')
 or (select count(distinct value->>'evidence_id') from jsonb_array_elements(p_body->'reused_decisions'))<>31
 or not exists(select 1 from public.organization_members m where m.organization_id=s.organization_id and m.user_id=s.authority_user_id and m.role in ('owner','admin','manager'))
 then raise exception 'JLS_CHILL_V21_REUSE_CHANGED';end if;

 for b in select value from jsonb_array_elements(p_body->'branches') loop
 if b->>'assumption' not in('ACCEPTED','REJECTED','UNCERTAIN') or b->>'conditional_not_prediction' is distinct from 'true'
 or b->>'sha256' is distinct from public.jls_restaurant_hash(b-'sha256')
 or b->'draft'->>'version' is distinct from 'jls-recommendation-contract-v2.1'
 or b->'draft'->>'config_sha256' is distinct from r.body->'future_preparation'->>'configuration_sha256'
 or b->'draft'->>'format_version' is distinct from 'jls-prioritized-recommendations-v2'
 or b->'draft'->>'prompt_sha256' is distinct from r.body->'future_preparation'->>'prompt_sha256'
 or b->'draft'->>'schema_sha256' is distinct from r.body->'future_preparation'->>'schema_sha256'
 or b->'draft'->>'dossier_sha256' is distinct from public.jls_restaurant_hash(b->'draft'->'packet')
 or b->'draft'->>'token_certificate_sha256' is distinct from public.jls_restaurant_hash(b->'draft'->'token_certificate')
 or b->>'request_raw_sha256' is distinct from encode(extensions.digest(b->>'request_json','sha256'),'hex')
 or b->'draft'->>'request_sha256' is distinct from public.jls_restaurant_hash((b->>'request_json')::jsonb)
 or b->'draft'->'request' is distinct from (b->>'request_json')::jsonb or b->'draft'->'request'->>'model' is distinct from 'gpt-6.1-sol'
 or b->'draft'->'request'->'input'->0->>'content' is distinct from b->'draft'->>'prompt'
 or (b->'draft'->'request'->'input'->1->>'content')::jsonb is distinct from b->'draft'->'packet'
 or b->'draft'->'measurement'->>'input_budget_tokens' is distinct from '32768'
 or (b->'draft'->'measurement'->>'guarded_input_tokens')::int not between 1 and 32768
 or b->'draft'->'measurement'->>'output_reserved_tokens' is distinct from '9500' or octet_length(b->>'request_json')>1048576
 or (b->'draft'->'packet'->'evidence' @> jsonb_build_array(jsonb_build_object('evidence_id',p_body->>'removed_evidence_id')))
 or ((b->'draft'->'accepted_ids') ? (p_body->>'candidate_evidence_id')) is distinct from (b->>'assumption'='ACCEPTED')
 then raise exception 'JLS_V2_BRANCH_INVALID';end if;
 for e in select value from jsonb_array_elements(b->'draft'->'packet'->'evidence') loop
 if not exists(select 1 from jsonb_array_elements(p_body->'plan'->'selected') x where x.value->>'evidence_id'=e->>'evidence_id' and x.value->>'quote_sha256'=e->>'quote_sha256' and x.value->>'quote'=e->>'quote' and x.value->>'context'=e->>'context')
 then raise exception 'JLS_V2_BRANCH_QUOTE_CHANGED';end if;end loop;
 end loop;
 insert into public.analysis_jls_contract_v2_protocols(organization_id,establishment_id,authority_user_id,source_snapshot_archive_id,source_artifact_id,body,sha256)
 values(s.organization_id,s.establishment_id,s.authority_user_id,r.id,a.id,p_body,p_sha) on conflict(sha256) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_contract_v2_protocols where sha256=p_sha;end if;return rid;end $function$;


revoke all on function public.check_jls_contract_v2_garden_sources(uuid),public.save_jls_chill_v21_protocol(jsonb,text) from public,anon,authenticated;
grant execute on function public.check_jls_contract_v2_garden_sources(uuid),public.save_jls_chill_v21_protocol(jsonb,text) to service_role;
alter function public.save_jls_chill_v21_protocol(jsonb,text) set jit='off';
-- No consent, paid operation, task, network call or deployment-triggered job.
