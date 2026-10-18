-- Additive executor for the already sealed nine-review diagnostic. No launch in DDL.
-- Existing append-only storage, organization RLS and immutable trigger are reused.
create function public.check_jev_targeted9(p_protocol uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $fn$
declare p public.analysis_jls_snapshot_preparations;b jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_snapshot_preparations where id=p_protocol;
 if p.id is distinct from '3f6ab86c-7557-431b-9389-4fa85054a00e'::uuid
 or p.kind is distinct from 'jev_audit_boundaries_targeted9_v1'
 or p.sha256 is distinct from '8fc0d34ca7bd79c2fa0fa2306c03cc0d2607bb4da61b22d17d7ebc17835528b4'
 or public.jls_restaurant_hash(p.body) is distinct from p.sha256
 or not exists(select 1 from public.analysis_jls_restaurant_protocols s where s.id=p.protocol_id
 and s.organization_id=p.organization_id and s.sha256=p.body->>'source_protocol_sha256')
 or not exists(select 1 from public.organization_members m where m.organization_id=p.organization_id
 and m.user_id=(p.body->>'authority_user_id')::uuid and m.role in('owner','admin','manager'))
 then return false;end if;
 for b in select value from jsonb_array_elements(p.body->'baseline') loop
 if not exists(select 1 from public.analysis_jev_review_cache c where c.id=(b->>'cache_id')::uuid
 and c.review_id=(b->>'review_id')::uuid and c.organization_id=p.organization_id
 and c.establishment_id=(p.body->>'establishment_id')::uuid and c.status='completed'
 and c.analysis_text_sha256=b->>'analysis_text_sha256' and c.configuration_id=b->>'configuration_id'
 and c.instruction_sha256=b->>'instruction_sha256' and c.threshold_sha256=b->>'threshold_sha256'
 and c.served_model=b->>'served_model' and public.jls_restaurant_hash(c.response)=b->>'response_sha256'
 and public.jls_restaurant_hash(c.theme_results)=b->>'theme_results_sha256') then return false;end if;
 end loop;return true;
end $fn$;

create function public.authorize_jev_targeted9(p_protocol uuid,p_directive text,p_directive_sha text,p_code text) returns uuid
language plpgsql security invoker set search_path='' as $fn$
declare p public.analysis_jls_snapshot_preparations;v jsonb;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_snapshot_preparations where id=p_protocol for update;
 if not public.check_jev_targeted9(p.id) then raise exception 'TARGETED_SOURCE_INVALID';end if;
 select id into rid from public.analysis_jls_snapshot_preparations where protocol_id=p.protocol_id and kind='jev_targeted9_execution_v1';
 if rid is not null then return rid;end if;
 if p_directive is null or p_code is null or p_directive_sha is distinct from encode(extensions.digest(p_directive,'sha256'),'hex')
 or position(p.id::text in p_directive)=0 or position('GO' in p_directive)=0
 or length(p_directive)<200 or p_code !~ '^[0-9a-f]{40}$'
 then raise exception 'TARGETED_EXPLICIT_GO_REQUIRED';end if;
 v=jsonb_build_object('version','jev-targeted9-execution-v1','targeted_protocol_id',p.id,'protocol_sha256',p.sha256,
 'configuration_sha256',p.body->>'configuration_sha256','request_manifest_sha256',p.body->>'request_manifest_sha256',
 'consent_source','user_directive_codex_delegation','directive',p_directive,'directive_sha256',p_directive_sha,
 'operator_identity',jsonb_build_object('kind','codex_admin','channel','supabase_mcp','database_role',current_user),
 'authority_user_id',p.body->>'authority_user_id','requested_at',now(),'expires_at',now()+interval '24 hours',
 'scope',p.body->'policy','executor_code_commit',p_code,'historical_parent_is_not_authorized',true);
 return public.save_jls_snapshot_preparation(p.protocol_id,'jev_targeted9_execution_v1',v,public.jls_restaurant_hash(v));
end $fn$;

create function public.reserve_jev_targeted9(p_execution uuid,p_review uuid,p_request_sha text,p_worker text) returns uuid
language plpgsql security invoker set search_path='' as $fn$
declare e public.analysis_jls_snapshot_preparations;p public.analysis_jls_snapshot_preparations;r jsonb;v jsonb;rid uuid;i int;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into e from public.analysis_jls_snapshot_preparations where id=p_execution for update;
 if e.kind is distinct from 'jev_targeted9_execution_v1' or e.sha256 is distinct from public.jls_restaurant_hash(e.body)
 or (e.body->>'expires_at')::timestamptz<=now() then raise exception 'TARGETED_GO_INVALID_OR_EXPIRED';end if;
 select * into p from public.analysis_jls_snapshot_preparations where id=(e.body->>'targeted_protocol_id')::uuid;
 if e.protocol_id is distinct from p.protocol_id or e.body->>'protocol_sha256' is distinct from p.sha256
 or e.body->'scope' is distinct from p.body->'policy' or e.body->>'consent_source' is distinct from 'user_directive_codex_delegation'
 or e.body->>'configuration_sha256' is distinct from p.body->>'configuration_sha256'
 or e.body->>'request_manifest_sha256' is distinct from p.body->>'request_manifest_sha256'
 or e.body->>'directive_sha256' is distinct from encode(extensions.digest(e.body->>'directive','sha256'),'hex')
 or not public.check_jev_targeted9(p.id) then raise exception 'TARGETED_SOURCE_INVALID';end if;
 select value into r from jsonb_array_elements(p.body->'reviews') where value->>'id'=p_review::text;
 if r is null or p_request_sha is distinct from r->>'request_sha256' or p_worker is null or length(p_worker)<10 then raise exception 'TARGETED_REQUEST_INVALID';end if;
 i=(r->>'position')::int;
 -- Previous terminal records are required: sequential dispatch, including concurrent wakes.
 if exists(select 1 from generate_series(1,i-1)n where not exists(select 1 from public.analysis_jls_snapshot_preparations a
 where a.protocol_id=p.protocol_id and a.kind='jev_targeted9_result_'||lpad(n::text,2,'0')))
 then return null;end if;
 v=jsonb_build_object('version','jev-targeted9-attempt-v1','execution_id',e.id,'targeted_protocol_id',p.id,
 'protocol_sha256',p.sha256,'review_id',p_review,'position',i,'request_sha256',p_request_sha,
 'request_raw_sha256',r->>'request_raw_sha256','configuration_sha256',p.body->>'configuration_sha256',
 'requested_model','jev-latest','endpoint','https://api.typesafe.ai/v1/systemone','worker',p_worker,
 'reserved_at',now(),'attempt_count',1,'uncertain_dispatch_is_consumed',true);
 insert into public.analysis_jls_snapshot_preparations(organization_id,protocol_id,kind,body,sha256)
 values(p.organization_id,p.protocol_id,'jev_targeted9_attempt_'||lpad(i::text,2,'0'),v,public.jls_restaurant_hash(v))
 on conflict(protocol_id,kind) do nothing returning id into rid;
 -- A conflict NEVER returns the old reservation to a caller.
 return rid;
end $fn$;

create function public.wake_jev_targeted9(p_execution uuid) returns bigint
language plpgsql security invoker set search_path='' as $fn$
declare e public.analysis_jls_snapshot_preparations;n bigint;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into e from public.analysis_jls_snapshot_preparations where id=p_execution;
 if e.kind is distinct from 'jev_targeted9_execution_v1' or e.sha256 is distinct from public.jls_restaurant_hash(e.body)
 then raise exception 'TARGETED_EXECUTION_INVALID';end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-jls-restaurant',
 headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',
 (select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
 body:=jsonb_build_object('mode','jev_targeted9','execution_id',e.id),timeout_milliseconds:=1000) into n;
 return n;
end $fn$;

revoke all on function public.check_jev_targeted9(uuid),public.authorize_jev_targeted9(uuid,text,text,text),
 public.reserve_jev_targeted9(uuid,uuid,text,text),public.wake_jev_targeted9(uuid) from public,anon,authenticated;
grant execute on function public.check_jev_targeted9(uuid),public.authorize_jev_targeted9(uuid,text,text,text),
 public.reserve_jev_targeted9(uuid,uuid,text,text),public.wake_jev_targeted9(uuid) to service_role;
