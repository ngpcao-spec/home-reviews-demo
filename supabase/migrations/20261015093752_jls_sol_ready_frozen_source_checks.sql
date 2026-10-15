-- Parent/native sources were fully verified once at sealing and are immutable.
-- Every wake still hashes the actual final protocol/request/artifact in Edge,
-- compares live cache rows, and checks native task/response hashes in SQL.
CREATE OR REPLACE FUNCTION public.check_jls_sol_ready_sources(p_body jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare p public.analysis_jls_restaurant_protocols;r public.analysis_jls_restaurant_runs;x jsonb;t public.analysis_jls_restaurant_tasks;a public.analysis_jls_restaurant_artifacts;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=(p_body->>'source_protocol_id')::uuid;
 select * into r from public.analysis_jls_restaurant_runs where id=(p_body->>'source_run_id')::uuid;
 if p.id is null or r.protocol_id<>p.id or r.status<>'blocked' or p.sha256<>p_body->>'source_protocol_sha256'
 or jsonb_array_length(p_body->'source_tasks')<>28
 or jsonb_array_length(p_body->'decisions')<>32 or p_body->>'decisions_sha256'<>public.jls_restaurant_hash(p_body->'decisions')
 or exists(select 1 from jsonb_array_elements(p.body->'cache') x left join public.analysis_jev_review_cache c on c.id=(x->>'id')::uuid where c.id is null or c.status<>'completed' or c.organization_id<>p.organization_id or c.establishment_id<>p.establishment_id or to_jsonb(c)<>x)
 or exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=r.id and phase='sol')
 or not exists(select 1 from public.analysis_jls_restaurant_artifacts d where d.run_id=r.id and d.kind='luna_decisions'
 and d.sha256=p_body->>'source_decisions_artifact_sha256' and d.sha256=public.jls_restaurant_hash(d.body)
 and d.body->>'decisions_sha256'=p_body->>'decisions_sha256') then return false;end if;
 for x in select value from jsonb_array_elements(p_body->'source_tasks') loop
 select * into t from public.analysis_jls_restaurant_tasks where id=(x->>'task_id')::uuid;
 select * into a from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='task:'||t.id;
 if t.id is null or t.run_id<>r.id or t.organization_id<>r.organization_id or t.phase<>'luna' or t.status<>'completed' or t.request_count<>1
 or t.review_id::text<>x->>'review_id' or t.request_sha256<>x->>'request_sha256' or t.request_sha256<>public.jls_restaurant_hash(t.request)
 or a.sha256 is distinct from x->>'artifact_sha256' or a.sha256<>public.jls_restaurant_hash(a.body)
 or a.body->>'response_sha256' is distinct from x->>'response_sha256'
 or a.body->>'response_sha256'<>public.jls_restaurant_hash(a.body->'response') then return false;end if;
 end loop;return true;end $function$;
CREATE OR REPLACE FUNCTION public.save_jls_sol_ready_artifact(p_body jsonb, p_sha text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare p public.analysis_jls_restaurant_protocols;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=(p_body->>'source_protocol_id')::uuid;
 if p.sha256<>public.jls_restaurant_hash(p.body) or p_sha<>public.jls_restaurant_hash(p_body) or p_body->>'version'<>'jls-sol-final-request-v1' or not public.check_jls_sol_ready_sources(p_body)
 or p_body->>'plan_sha256'<>public.jls_restaurant_hash(p_body->'plan') or p_body->'plan'->>'source_sha256'<>p.body->'snapshot'->>'source_sha256'
 or p_body->'sol'->'gate'->>'passed' is distinct from 'true'
 or p_body->>'token_certificate_sha256'<>public.jls_restaurant_hash(p_body->'token_certificate')
 or p_body->>'request_raw_sha256'<>encode(extensions.digest(p_body->>'request_json','sha256'),'hex')
 or p_body->>'request_sha256'<>public.jls_restaurant_hash((p_body->>'request_json')::jsonb)
 or p_body->'sol'->'draft'->>'request_sha256'<>p_body->>'request_sha256'
 or p_body->'measurement'->>'input_budget_tokens' is distinct from '32768'
 or (p_body->'measurement'->>'guarded_input_tokens')::int not between 1 and 32768
 or p_body->'measurement'->>'output_reserved_tokens' is distinct from '9500'
 or octet_length(p_body->>'request_json')>1048576 then raise exception 'JLS_SOL_READY_ARTIFACT_INVALID';end if;
 insert into public.analysis_jls_sol_ready_artifacts(organization_id,source_protocol_id,source_run_id,body,sha256)
 values(p.organization_id,p.id,(p_body->>'source_run_id')::uuid,p_body,p_sha) on conflict(sha256) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_sol_ready_artifacts where sha256=p_sha;end if;return rid;end $function$;
CREATE OR REPLACE FUNCTION public.claim_jls_sol_ready(p_operation uuid, p_worker text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o public.analysis_jls_sol_ready_operations;a public.analysis_jls_sol_ready_artifacts;t jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into o from public.analysis_jls_sol_ready_operations where id=p_operation for update;
 if o.id is null or o.status in('completed','needs_review','invalid_output','blocked','billing_uncertain','authorization_expired') or o.lease_until>now() then return null;end if;
 select * into a from public.analysis_jls_sol_ready_artifacts where id=o.artifact_id;
 if not public.check_jls_sol_ready_sources(a.body) then raise exception 'JLS_REUSED_SOURCES_CHANGED';end if;
 if o.phase='sol' and o.request_count=1 then
 update public.analysis_jls_sol_ready_operations set status='billing_uncertain',error_code='JLS_LOST_ATTEMPT_NO_RETRY' where id=o.id;
 if o.mode='paid' then update public.analysis_jls_restaurant_runs set status='billing_uncertain',error_code='JLS_LOST_ATTEMPT_NO_RETRY' where id=o.run_id and status in('queued','running');end if;return null;end if;
 if o.mode='paid' then
 if not public.claim_jls_restaurant_tick(o.run_id,p_worker) then return null;end if;
 if o.phase='sol' then
 t=public.claim_jls_restaurant_task(o.run_id,p_worker);
 if t is null or t->>'id'<>o.task_id::text or t->>'request_sha256'<>a.body->>'request_sha256' then raise exception 'JLS_READY_TASK_CHANGED';end if;
 end if;end if;
 update public.analysis_jls_sol_ready_operations set worker=p_worker,lease_until=now()+interval '5 minutes',
 request_count=case when phase='sol' then 1 else request_count end,status=case when phase='sol' then 'dispatched' else 'validating' end
 where id=o.id returning * into o;return to_jsonb(o)-array['protocol_body','metrics','result'];end $function$;
CREATE OR REPLACE FUNCTION public.jls_restaurant_state_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if tg_op='DELETE' then raise exception 'JLS_HISTORY_IMMUTABLE';end if;
 if tg_table_name='analysis_jls_restaurant_runs' then
  if old.status not in('queued','running') then
   if (to_jsonb(new)-array['worker','lease_until']) is distinct from (to_jsonb(old)-array['worker','lease_until']) then raise exception 'JLS_RUN_IMMUTABLE';end if;
  elsif (to_jsonb(new)-array['status','stage','error_code','worker','lease_until']) is distinct from (to_jsonb(old)-array['status','stage','error_code','worker','lease_until']) then raise exception 'JLS_RUN_IMMUTABLE';end if;
 else
  if old.status='received' and exists(select 1 from public.analysis_jls_restaurant_runs r join public.analysis_jls_restaurant_protocols p on p.id=r.protocol_id where r.id=old.run_id and p.body->>'version'='jls-restaurant-sol-ready-vi-v1') then
   if new.status not in('completed','needs_review','invalid_output','billing_uncertain','blocked') or new.request_count<>1
   or (to_jsonb(new)-array['status','completed_at','error_code']) is distinct from (to_jsonb(old)-array['status','completed_at','error_code'])
   then raise exception 'JLS_NO_RETRY';end if;return new;
  end if;
  if old.status not in('pending','running') or new.request_count<old.request_count
  or (to_jsonb(new)-array['status','request_count','worker','dispatched_at','completed_at','error_code','cache_id']) is distinct from (to_jsonb(old)-array['status','request_count','worker','dispatched_at','completed_at','error_code','cache_id'])
  or old.request_count=1 and new.request_count<>1 then raise exception 'JLS_NO_RETRY';end if;
 end if;return new;end $function$;
create function public.check_jls_sol_ready_sources_id(p_artifact uuid) returns boolean language plpgsql stable set search_path='' as $$
declare a public.analysis_jls_sol_ready_artifacts;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into a from public.analysis_jls_sol_ready_artifacts where id=p_artifact;
 return a.id is not null and public.check_jls_sol_ready_sources(a.body);
end $$;
revoke all on function public.check_jls_sol_ready_sources_id(uuid) from public,anon,authenticated;
grant execute on function public.check_jls_sol_ready_sources_id(uuid) to service_role;
