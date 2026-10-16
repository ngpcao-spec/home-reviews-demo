-- Preparation objects only. No consent, paid operation, scheduler wake or provider call.
create table public.analysis_jls_contract_v2_protocols(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 establishment_id uuid not null references public.establishments(id),authority_user_id uuid not null,
 source_archive_id uuid not null references public.analysis_jls_recommendation_reviews(id),
 source_artifact_id uuid not null references public.analysis_jls_sol_ready_artifacts(id),
 body jsonb not null,sha256 text not null unique,created_at timestamptz not null default now(),unique(id,organization_id));
create table public.analysis_jls_contract_v2_operations(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,
 protocol_id uuid not null,mode text not null check(mode in('mock','paid')),nonce text not null,
 consent jsonb,consent_sha256 text,expires_at timestamptz,
 phase text not null default 'luna' check(phase in('luna','validate_luna','sol','validate_sol')),
 status text not null default 'queued' check(status in('queued','dispatched','received','validating','completed','needs_review','blocked','billing_uncertain','invalid_output','authorization_expired')),
 luna_count int not null default 0 check(luna_count in(0,1)),sol_count int not null default 0 check(sol_count in(0,1)),
 worker text,lease_until timestamptz,luna_receipt jsonb,luna_receipt_sha256 text,luna_result jsonb,luna_result_sha256 text,
 branch text check(branch in('ACCEPTED','REJECTED','UNCERTAIN')),sol_receipt jsonb,sol_receipt_sha256 text,
 result jsonb,result_sha256 text,error_code text,metrics jsonb not null default '[]',created_at timestamptz not null default now(),
 foreign key(protocol_id,organization_id) references public.analysis_jls_contract_v2_protocols(id,organization_id),unique(protocol_id,mode,nonce),
 check((mode='mock' and consent is null and consent_sha256 is null and expires_at is null) or
 (mode='paid' and consent is not null and consent_sha256 is not null and expires_at is not null)));
create unique index jls_contract_v2_one_paid on public.analysis_jls_contract_v2_operations(protocol_id) where mode='paid';
create table public.analysis_jls_contract_v2_checks(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,protocol_id uuid not null unique,
 body jsonb not null,sha256 text not null unique,created_at timestamptz not null default now(),
 foreign key(protocol_id,organization_id) references public.analysis_jls_contract_v2_protocols(id,organization_id));
create index on public.analysis_jls_contract_v2_protocols(organization_id);
create index on public.analysis_jls_contract_v2_protocols(establishment_id);
create index on public.analysis_jls_contract_v2_protocols(source_archive_id);
create index on public.analysis_jls_contract_v2_protocols(source_artifact_id);
create index on public.analysis_jls_contract_v2_operations(organization_id);
create index on public.analysis_jls_contract_v2_checks(organization_id);
do $fn$declare t text;begin foreach t in array array['analysis_jls_contract_v2_protocols','analysis_jls_contract_v2_operations','analysis_jls_contract_v2_checks'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);execute format('grant all on public.%I to service_role',t);
 execute format('create policy contract_v2_org_read on public.%I for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=%I.organization_id and m.user_id=(select auth.uid()) and m.role in(''owner'',''admin'',''manager'')))',t,t);
 end loop;end $fn$;
create trigger contract_v2_protocol_immutable before update or delete on public.analysis_jls_contract_v2_protocols for each row execute function public.pilot_evidence_immutable();
create trigger contract_v2_check_immutable before update or delete on public.analysis_jls_contract_v2_checks for each row execute function public.pilot_evidence_immutable();
create function public.jls_contract_v2_guard() returns trigger language plpgsql security invoker set search_path='' as $fn$
begin
 if tg_op='DELETE' then raise exception 'JLS_HISTORY_IMMUTABLE';end if;
 if old.status in('completed','needs_review','blocked','billing_uncertain','invalid_output','authorization_expired') then
 if old.mode<>'mock' or (to_jsonb(new)-'metrics') is distinct from (to_jsonb(old)-'metrics') then raise exception 'JLS_V2_RESULT_IMMUTABLE';end if;return new;end if;
 if (to_jsonb(new)-array['phase','status','luna_count','sol_count','worker','lease_until','luna_receipt','luna_receipt_sha256','luna_result','luna_result_sha256','branch','sol_receipt','sol_receipt_sha256','result','result_sha256','error_code','metrics'])
 is distinct from (to_jsonb(old)-array['phase','status','luna_count','sol_count','worker','lease_until','luna_receipt','luna_receipt_sha256','luna_result','luna_result_sha256','branch','sol_receipt','sol_receipt_sha256','result','result_sha256','error_code','metrics'])
 or new.luna_count<old.luna_count or new.sol_count<old.sol_count
 or old.luna_receipt is not null and (new.luna_receipt is distinct from old.luna_receipt or new.luna_receipt_sha256 is distinct from old.luna_receipt_sha256)
 or old.luna_result is not null and (new.luna_result is distinct from old.luna_result or new.luna_result_sha256 is distinct from old.luna_result_sha256 or new.branch is distinct from old.branch)
 or old.sol_receipt is not null and (new.sol_receipt is distinct from old.sol_receipt or new.sol_receipt_sha256 is distinct from old.sol_receipt_sha256)
 or old.result is not null and (new.result is distinct from old.result or new.result_sha256 is distinct from old.result_sha256)
 then raise exception 'JLS_V2_NO_RETRY_OR_REWRITE';end if;return new;end $fn$;
create trigger contract_v2_operation_guard before update or delete on public.analysis_jls_contract_v2_operations for each row execute function public.jls_contract_v2_guard();
create function public.check_jls_contract_v2_sources(p_protocol uuid) returns boolean language plpgsql stable security invoker set search_path='' as $fn$
declare p public.analysis_jls_contract_v2_protocols;a public.analysis_jls_sol_ready_artifacts;r public.analysis_jls_recommendation_reviews;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_contract_v2_protocols where id=p_protocol;
 select * into a from public.analysis_jls_sol_ready_artifacts where id=p.source_artifact_id;
 select * into r from public.analysis_jls_recommendation_reviews where id=p.source_archive_id;
 return p.id is not null and a.organization_id=p.organization_id and r.organization_id=p.organization_id
 and a.sha256=p.body->>'source_artifact_sha256' and r.sha256=p.body->>'source_archive_sha256'
 and a.sha256=public.jls_restaurant_hash(a.body) and r.sha256=public.jls_restaurant_hash(r.body)
 and r.body->>'original_result_sha256'=p.body->>'source_result_sha256'
 and public.check_jls_sol_ready_sources(a.body)
 and exists(select 1 from public.organization_members m where m.organization_id=p.organization_id and m.user_id=p.authority_user_id and m.role in('owner','admin','manager'));
end $fn$;
create function public.save_jls_contract_v2_protocol(p_body jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' as $fn$
declare a public.analysis_jls_sol_ready_artifacts;r public.analysis_jls_recommendation_reviews;s public.analysis_jls_restaurant_protocols;
 b jsonb;e jsonb;candidate jsonb;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into a from public.analysis_jls_sol_ready_artifacts where id=(p_body->>'source_artifact_id')::uuid;
 select * into r from public.analysis_jls_recommendation_reviews where id=(p_body->>'source_archive_id')::uuid;
 select * into s from public.analysis_jls_restaurant_protocols where id=(p_body->>'source_protocol_id')::uuid;
 candidate=r.body->'order_candidates'->0;
 if a.id is null or r.id is null or s.id is null or a.organization_id<>s.organization_id or r.organization_id<>s.organization_id
 or p_sha is distinct from public.jls_restaurant_hash(p_body) or p_body->>'version' is distinct from 'jls-contract-v2-garden-delegated-vi-v1'
 or p_body->>'language' is distinct from 'vi' or p_body->>'preparation_is_not_spending_authorization' is distinct from 'true'
 or p_body->>'organization_id' is distinct from s.organization_id::text or p_body->>'authority_user_id' is distinct from s.authority_user_id::text
 or p_body->>'establishment_id' is distinct from 'd40d3438-79d8-4c28-8b09-eba640598201'
 or p_body->>'source_artifact_sha256' is distinct from a.sha256 or p_body->>'source_archive_sha256' is distinct from r.sha256
 or p_body->>'source_protocol_sha256' is distinct from s.sha256 or p_body->>'snapshot_sha256' is distinct from public.jls_restaurant_hash(s.body->'snapshot')
 or p_body->>'source_run_id' is distinct from r.run_id::text or p_body->>'source_result_sha256' is distinct from r.body->>'original_result_sha256'
 or p_body->>'source_decisions_sha256' is distinct from a.body->>'decisions_sha256' or jsonb_array_length(s.body->'cache')<>78
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
 for b in select value from jsonb_array_elements(p_body->'branches') loop
 if b->>'assumption' not in('ACCEPTED','REJECTED','UNCERTAIN') or b->>'conditional_not_prediction' is distinct from 'true'
 or b->>'sha256' is distinct from public.jls_restaurant_hash(b-'sha256')
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
 insert into public.analysis_jls_contract_v2_protocols(organization_id,establishment_id,authority_user_id,source_archive_id,source_artifact_id,body,sha256)
 values(s.organization_id,s.establishment_id,s.authority_user_id,r.id,a.id,p_body,p_sha) on conflict(sha256) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_contract_v2_protocols where sha256=p_sha;end if;return rid;end $fn$;
create function public.create_jls_contract_v2_probe(p_protocol uuid,p_nonce text) returns uuid language plpgsql security invoker set search_path='' as $fn$
declare p public.analysis_jls_contract_v2_protocols;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_contract_v2_protocols where id=p_protocol;
 if p.id is null or not public.check_jls_contract_v2_sources(p.id) or length(p_nonce)<5 then raise exception 'JLS_V2_PROBE_INVALID';end if;
 insert into public.analysis_jls_contract_v2_operations(organization_id,protocol_id,mode,nonce) values(p.organization_id,p.id,'mock',p_nonce)
 on conflict(protocol_id,mode,nonce) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_contract_v2_operations where protocol_id=p.id and mode='mock' and nonce=p_nonce;end if;return rid;end $fn$;
-- Pure validation does not create consent or an execution; also exercised in SQL tests.
create function public.valid_jls_contract_v2_consent(p_protocol uuid,p_consent jsonb,p_sha text,p_fresh boolean default true) returns boolean language plpgsql stable security invoker set search_path='' as $fn$
declare p public.analysis_jls_contract_v2_protocols;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_contract_v2_protocols where id=p_protocol;
 return coalesce(p.id is not null and p_consent is not null and p_sha=public.jls_restaurant_hash(p_consent)
 and p_consent->>'protocol_sha256'=p.sha256 and p_consent->>'protocol_id'=p.id::text
 and p_consent->>'consent_source'='user_directive_codex_delegation'
 and p_consent->'operator_identity'='{"kind":"codex_admin","channel":"supabase_mcp"}'::jsonb
 and length(p_consent->>'user_directive')>=20
 and p_consent->>'directive_sha256'=encode(extensions.digest(p_consent->>'user_directive','sha256'),'hex')
 and (not p_fresh or abs(extract(epoch from now()-(p_consent->>'requested_at')::timestamptz))<=300)
 and (p_consent->>'requested_at')::timestamptz<=now()+interval '5 minutes'
 and (p_consent->>'expires_at')::timestamptz>now()
 and (p_consent->>'expires_at')::timestamptz<=(p_consent->>'requested_at')::timestamptz+interval '24 hours'
 and p_consent->'scope'=jsonb_build_object('organization_id',p.organization_id,'establishment_id',p.establishment_id,
 'language','vi','configuration_sha256',p.body->>'configuration_sha256','max_jev_calls',0,'max_luna_calls',1,'max_questions',1,'max_sol_calls',1,'apify_calls',0,'automatic_retry',false,'provider_client_retries',0),false);
end $fn$;
create function public.authorize_jls_contract_v2(p_protocol uuid,p_consent jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' as $fn$
declare p public.analysis_jls_contract_v2_protocols;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_contract_v2_protocols where id=p_protocol for update;
 if p.id is null then raise exception 'JLS_V2_PROTOCOL_MISSING';end if;
 select id into rid from public.analysis_jls_contract_v2_operations where protocol_id=p.id and mode='paid';if rid is not null then return rid;end if;
 if not public.valid_jls_contract_v2_consent(p.id,p_consent,p_sha)
 or not public.check_jls_contract_v2_sources(p.id) or not exists(select 1 from public.analysis_jls_contract_v2_checks where protocol_id=p.id)
 then raise exception 'JLS_V2_NEW_GO_REQUIRED';end if;
 insert into public.analysis_jls_contract_v2_operations(organization_id,protocol_id,mode,nonce,consent,consent_sha256,expires_at)
 values(p.organization_id,p.id,'paid','single_execution',p_consent,p_sha,(p_consent->>'expires_at')::timestamptz) returning id into rid;return rid;end $fn$;
create function public.claim_jls_contract_v2(p_operation uuid,p_worker text) returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare o public.analysis_jls_contract_v2_operations;p public.analysis_jls_contract_v2_protocols;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into o from public.analysis_jls_contract_v2_operations where id=p_operation for update;
 if o.id is null or o.status not in('queued','received','dispatched','validating') or o.lease_until>now() then return null;end if;
 select * into p from public.analysis_jls_contract_v2_protocols where id=o.protocol_id;
 if not public.check_jls_contract_v2_sources(p.id) then raise exception 'JLS_V2_REUSED_SOURCE_CHANGED';end if;
 if o.mode='paid' and (o.expires_at<=now() or not public.valid_jls_contract_v2_consent(p.id,o.consent,o.consent_sha256,false))
 then update public.analysis_jls_contract_v2_operations set status='authorization_expired',worker=null,lease_until=null where id=o.id;return null;end if;
 if o.phase='luna' and o.luna_count=1 or o.phase='sol' and o.sol_count=1 then
 update public.analysis_jls_contract_v2_operations set status='billing_uncertain',error_code='JLS_V2_LOST_ATTEMPT_NO_RETRY',worker=null,lease_until=null where id=o.id;return null;end if;
 if o.phase='sol' and (o.luna_result is null or o.luna_result->'sol_gate'->>'passed' is distinct from 'true' or o.branch is null)
 then raise exception 'JLS_SOL_EVIDENCE_INSUFFICIENT';end if;
 update public.analysis_jls_contract_v2_operations set worker=p_worker,lease_until=now()+interval '5 minutes',
 luna_count=case when phase='luna' then 1 else luna_count end,sol_count=case when phase='sol' then 1 else sol_count end,
 status=case when phase in('luna','sol') then 'dispatched' else 'validating' end where id=o.id returning * into o;return to_jsonb(o);end $fn$;
create function public.receive_jls_contract_v2(p_operation uuid,p_worker text,p_phase text,p_body jsonb,p_sha text) returns boolean language plpgsql security invoker set search_path='' as $fn$
declare o public.analysis_jls_contract_v2_operations;p public.analysis_jls_contract_v2_protocols;b jsonb;req text;rawsha text;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into o from public.analysis_jls_contract_v2_operations where id=p_operation for update;
 if p_phase not in('luna','sol') then return false;end if;
 if p_phase='luna' and o.luna_receipt is not null then return o.luna_receipt_sha256=p_sha;end if;
 if p_phase='sol' and o.sol_receipt is not null then return o.sol_receipt_sha256=p_sha;end if;
 select * into p from public.analysis_jls_contract_v2_protocols where id=o.protocol_id;
 if p_phase='luna' then req=p.body->'luna_group'->>'request_sha256';rawsha=p.body->>'luna_request_raw_sha256';
 else select value into b from jsonb_array_elements(p.body->'branches') where value->>'assumption'=o.branch;req=b->'draft'->>'request_sha256';rawsha=b->>'request_raw_sha256';end if;
 if o.worker is distinct from p_worker or o.phase<>p_phase or o.status<>'dispatched'
 or p_sha is distinct from public.jls_restaurant_hash(p_body) or p_body->>'request_sha256' is distinct from req or p_body->>'request_raw_sha256' is distinct from rawsha
 or (p_body->>'mock')::boolean is distinct from (o.mode='mock')
 or p_body->>'raw_response_text' is not null and p_body->>'raw_response_sha256' is distinct from encode(extensions.digest(p_body->>'raw_response_text','sha256'),'hex') then return false;end if;
 if p_phase='luna' then update public.analysis_jls_contract_v2_operations set luna_receipt=p_body,luna_receipt_sha256=p_sha,phase='validate_luna',
 status=case when p_body->>'raw_response_text' is null then 'billing_uncertain' else 'received' end,worker=null,lease_until=null where id=o.id;
 else update public.analysis_jls_contract_v2_operations set sol_receipt=p_body,sol_receipt_sha256=p_sha,phase='validate_sol',
 status=case when p_body->>'raw_response_text' is null then 'billing_uncertain' else 'received' end,worker=null,lease_until=null where id=o.id;end if;return true;end $fn$;
create function public.finish_jls_contract_v2_luna(p_operation uuid,p_worker text,p_body jsonb,p_sha text,p_branch text) returns boolean language plpgsql security invoker set search_path='' as $fn$
declare o public.analysis_jls_contract_v2_operations;p public.analysis_jls_contract_v2_protocols;b jsonb;d jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into o from public.analysis_jls_contract_v2_operations where id=p_operation for update;
 if o.luna_result is not null then return o.luna_result_sha256=p_sha;end if;
 select * into p from public.analysis_jls_contract_v2_protocols where id=o.protocol_id;
 select value into b from jsonb_array_elements(p.body->'branches') where value->>'assumption'=p_branch;d=p_body->'decisions'->0;
 if o.worker is distinct from p_worker or o.phase<>'validate_luna' or o.status<>'validating' or o.luna_count<>1 or b is null
 or p_sha is distinct from public.jls_restaurant_hash(p_body) or p_body->>'receipt_sha256' is distinct from o.luna_receipt_sha256
 or p_body->>'raw_response_sha256' is distinct from o.luna_receipt->>'raw_response_sha256'
 or jsonb_array_length(p_body->'decisions')<>1 or d->>'evidence_id' is distinct from p.body->>'candidate_evidence_id'
 or d->>'status' is distinct from p_branch or d->>'request_sha256' is distinct from p.body->'luna_group'->>'request_sha256'
 or p_body->'sol_gate' is distinct from b->'gate' then return false;end if;
 update public.analysis_jls_contract_v2_operations set luna_result=p_body,luna_result_sha256=p_sha,branch=p_branch,phase='sol',
 status=case when b->'gate'->>'passed'='true' then 'queued' else 'blocked' end,worker=null,lease_until=null where id=o.id;return true;end $fn$;
create function public.finish_jls_contract_v2_sol(p_operation uuid,p_worker text,p_status text,p_body jsonb,p_sha text) returns boolean language plpgsql security invoker set search_path='' as $fn$
declare o public.analysis_jls_contract_v2_operations;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into o from public.analysis_jls_contract_v2_operations where id=p_operation for update;
 if o.result is not null then return o.result_sha256=p_sha;end if;
 if o.worker is distinct from p_worker or o.phase<>'validate_sol' or o.status<>'validating' or o.sol_count<>1 or o.luna_count<>1
 or p_status not in('completed','needs_review','invalid_output','billing_uncertain') or p_sha is distinct from public.jls_restaurant_hash(p_body)
 or p_body->>'receipt_sha256' is distinct from o.sol_receipt_sha256 or p_body->>'raw_response_sha256' is distinct from o.sol_receipt->>'raw_response_sha256'
 then return false;end if;
 update public.analysis_jls_contract_v2_operations set result=p_body,result_sha256=p_sha,status=p_status,error_code=p_body->>'error_code',worker=null,lease_until=null where id=o.id;return true;end $fn$;
create function public.abort_jls_contract_v2(p_operation uuid,p_worker text,p_error text) returns void language plpgsql security invoker set search_path='' as $fn$
declare o public.analysis_jls_contract_v2_operations;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into o from public.analysis_jls_contract_v2_operations where id=p_operation for update;
 if o.id is null or o.status not in('queued','received','dispatched','validating') or o.worker is not null and o.worker<>p_worker then return;end if;
 update public.analysis_jls_contract_v2_operations set status=case when phase='luna' and luna_count=1 or phase='sol' and sol_count=1 then 'billing_uncertain' else 'blocked' end,
 error_code=p_error,worker=null,lease_until=null where id=o.id;end $fn$;
create function public.record_jls_contract_v2_metric(p_operation uuid,p_metric jsonb) returns void language plpgsql security invoker set search_path='' as $fn$
begin if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 update public.analysis_jls_contract_v2_operations set metrics=metrics||jsonb_build_array(p_metric) where id=p_operation and mode='mock';end $fn$;
create function public.qualify_jls_contract_v2(p_protocol uuid,p_body jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' as $fn$
declare p public.analysis_jls_contract_v2_protocols;case_name text;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_contract_v2_protocols where id=p_protocol;
 if p_sha is distinct from public.jls_restaurant_hash(p_body) or p_body->>'protocol_sha256' is distinct from p.sha256
 or p_body->>'provider_calls' is distinct from '0' or not public.check_jls_contract_v2_sources(p.id) then raise exception 'JLS_V2_NOT_QUALIFIED';end if;
 foreach case_name in array array['ACCEPTED','REJECTED','UNCERTAIN'] loop
 if not exists(select 1 from public.analysis_jls_contract_v2_operations o where o.protocol_id=p.id and o.mode='mock' and o.branch=case_name
 and o.status='completed' and o.luna_count=1 and o.sol_count=1 and jsonb_array_length(o.metrics)>=4
 and o.result->'validated_report'->>'format_version'='jls-prioritized-recommendations-v2') then raise exception 'JLS_V2_FULL_PATH_NOT_QUALIFIED';end if;end loop;
 if jsonb_array_length(p_body->'native_cpu_checks')<12 or exists(select 1 from jsonb_array_elements(p_body->'native_cpu_checks') x
 where (x.value->>'cpu_ms')::int not between 1 and 1500 or (x.value->>'memory_bytes')::bigint>=268435456 or x.value->>'execution_id' is null)
 then raise exception 'JLS_V2_EDGE_MARGIN_INSUFFICIENT';end if;
 insert into public.analysis_jls_contract_v2_checks(organization_id,protocol_id,body,sha256) values(p.organization_id,p.id,p_body,p_sha)
 on conflict(protocol_id) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_contract_v2_checks where protocol_id=p.id and sha256=p_sha;if rid is null then raise exception 'JLS_V2_QUALIFICATION_IMMUTABLE';end if;end if;return rid;end $fn$;
create function public.wake_jls_contract_v2(p_operation uuid) returns bigint language plpgsql security invoker set search_path='' as $fn$
declare o public.analysis_jls_contract_v2_operations;req bigint;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into o from public.analysis_jls_contract_v2_operations where id=p_operation;
 if o.id is null or o.mode='paid' and (o.expires_at<=now() or o.consent is null) then raise exception 'JLS_V2_NEW_GO_REQUIRED';end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-jls-restaurant',
 headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
 body:=jsonb_build_object('mode','contract_v2_operation','operation_id',o.id),timeout_milliseconds:=1000) into req;return req;end $fn$;
do $fn$declare f record;begin for f in select oid::regprocedure p from pg_proc where pronamespace='public'::regnamespace and
 (proname like '%jls_contract_v2%' or proname='jls_contract_v2_guard') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.p);execute format('grant execute on function %s to service_role',f.p);end loop;end $fn$;
