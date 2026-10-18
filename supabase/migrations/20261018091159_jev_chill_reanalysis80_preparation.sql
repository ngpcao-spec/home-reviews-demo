-- Preparation creates no execution, consent, task or wake. Historical rows remain immutable.
create function public.check_jev_chill80(p_protocol uuid) returns boolean language plpgsql stable security invoker set search_path='' as $fn$
declare p public.analysis_jls_snapshot_preparations;s public.analysis_jls_restaurant_protocols;b jsonb;r jsonb;t jsonb;v jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_snapshot_preparations where id=p_protocol;
 select * into s from public.analysis_jls_restaurant_protocols where id=p.protocol_id;
 if p.kind is distinct from 'jev_chill_reanalysis80_protocol_v1' or p.sha256 is distinct from public.jls_restaurant_hash(p.body)
 or p.body->>'version' is distinct from 'jev-chill-reanalysis80-boundaries-v1'
 or s.sha256 is distinct from p.body->>'source_protocol_sha256' or s.body->'snapshot'->>'source_sha256' is distinct from p.body->>'source_snapshot_sha256'
 or p.body->'reviews' is distinct from s.body->'snapshot'->'source'->'reviews'
 or p.body->>'organization_id' is distinct from p.organization_id::text
 or p.body->>'source_protocol_id' is distinct from s.id::text
 or p.body->>'establishment_id' is distinct from 'a9a6ec1c-cbb3-4e39-a498-86f2e68bd4b8'
 or p.body->>'source_historical_report_id' is distinct from '39556285-21ee-4962-9892-da3b4f0e8ca3'
 or p.body->'benchmark'->>'protocol_id' is distinct from '3f6ab86c-7557-431b-9389-4fa85054a00e'
 or p.body->'benchmark'->>'execution_id' is distinct from 'b9d96984-fe68-42ad-b1fe-d552473d2f16'
 or p.body->>'configuration_id' is distinct from 'v12_economy_audit_boundaries_v2_1pass_v1'
 or p.body->>'configuration_sha256' is distinct from '292384806354e610ab60588f803516e99ae5a0db6b7a47fd2cd1f7832a9305da'
 or p.body->>'instruction_sha256' is distinct from 'd1bf606df9a53c0b8ad2afcec223e68b081310f1305e552ed9656f40ff7646d1'
 or p.body->>'threshold_sha256' is distinct from 'e0c177cb371f523caeaad6add147b94cb318c7ec08df8961f864cb487a549de6'
 or p.body->>'requested_model' is distinct from 'jev-latest' or p.body->>'required_served_model' is distinct from 'jev-1.13.0'
 or p.body->'policy'->>'max_jev_calls' is distinct from '71' or p.body->'policy'->>'client_max_attempts' is distinct from '1'
 or p.body->'policy'->>'max_calls_per_review' is distinct from '1' or p.body->'policy'->>'concurrency' is distinct from '1'
 or p.body->'policy'->>'automatic_retry' is distinct from 'false' or p.body->'policy'->>'no_model_probe_call' is distinct from 'true'
 or p.body->'policy'->>'no_fallback_api' is distinct from 'true'
 or p.body->'policy'->>'max_luna_calls' is distinct from '0' or p.body->'policy'->>'max_sol_calls' is distinct from '0'
 or p.body->'policy'->>'max_apify_calls' is distinct from '0' or p.body->'policy'->>'reports_generated' is distinct from '0'
 or jsonb_array_length(p.body->'reused')<>9 or jsonb_array_length(p.body->'pending')<>71
 or jsonb_array_length(p.body->'baseline')<>80 or jsonb_array_length(p.body->'reviews')<>100
 or (select count(distinct x) from (select value->>'review_id' x from jsonb_array_elements(p.body->'reused') union all select value->>'review_id' from jsonb_array_elements(p.body->'pending')) q)<>80
 or p.body->>'pending_sha256' is distinct from public.jls_restaurant_hash(p.body->'pending')
 or p.body->>'reuses_sha256' is distinct from public.jls_restaurant_hash(p.body->'reused')
 or p.body->>'baseline_sha256' is distinct from public.jls_restaurant_hash(p.body->'baseline')
 or p.body->>'source_reviews_sha256' is distinct from public.jls_restaurant_hash(p.body->'reviews')
 or p.body->>'policy_sha256' is distinct from public.jls_restaurant_hash(p.body->'policy')
 or not public.check_jls_snapshot_v2_source(s.body)
 or not exists(select 1 from public.organization_members m where m.organization_id=p.organization_id and m.user_id=(p.body->>'authority_user_id')::uuid and m.role in('owner','admin','manager'))
 then return false;end if;
 select body into b from public.analysis_jls_snapshot_preparations where id=(p.body->'benchmark'->>'protocol_id')::uuid
 and sha256=p.body->'benchmark'->>'protocol_sha256';
 if b is null or b->'request_template' is distinct from p.body->'request_template' then return false;end if;
 for b in select value from jsonb_array_elements(p.body->'baseline') loop
 if not exists(select 1 from public.analysis_jev_review_cache c where c.id=(b->>'cache_id')::uuid and c.organization_id=p.organization_id
 and c.establishment_id=(p.body->>'establishment_id')::uuid and c.review_id=(b->>'review_id')::uuid and c.status='completed'
 and c.configuration_id='v12_economy_1pass_v1' and c.analysis_text_sha256=b->>'analysis_text_sha256'
 and c.instruction_sha256=b->>'instruction_sha256' and c.threshold_sha256=b->>'threshold_sha256' and c.served_model=b->>'served_model'
 and public.jls_restaurant_hash(c.response)=b->>'response_sha256' and public.jls_restaurant_hash(c.theme_results)=b->>'theme_results_sha256') then return false;end if;
 end loop;
 for r in select value from jsonb_array_elements(p.body->'reused') loop
 select body into b from public.analysis_jls_snapshot_preparations where id=(r->'provenance'->>'result_id')::uuid and sha256=r->'provenance'->>'result_sha256';
 select body into t from public.analysis_jls_snapshot_preparations where id=(r->'provenance'->>'receipt_id')::uuid and sha256=r->'provenance'->>'receipt_sha256';
 if b is null or t is null or b->>'execution_id' is distinct from p.body->'benchmark'->>'execution_id'
 or b->>'status' is distinct from 'completed' or b->'result'->>'served_model' is distinct from 'jev-1.13.0'
 or b->'result'->'native' is distinct from r->'native' or b->'result'->'theme_results' is distinct from r->'theme_results'
 or b->'result'->>'analysis_text_sha256' is distinct from r->>'analysis_text_sha256'
 or b->'result'->'usage' is distinct from r->'usage' or t->>'http_status' is distinct from '200'
 or t->>'response_raw_sha256' is distinct from encode(extensions.digest(t->>'raw_response_text','sha256'),'hex') then return false;end if;
 end loop;
 for t in select value from jsonb_array_elements(p.body->'pending') loop
 select value into r from jsonb_array_elements(p.body->'reviews') where value->>'id'=t->>'review_id';
 v=jsonb_build_object('model','jev-latest','state',t->'request_state','questions',p.body->'request_template'->'questions');
 if r is null or r->>'analysis_language' is distinct from 'en' or coalesce(r->>'analysis_text','')=''
 or t->'request_state'->>'analysis_text' is distinct from r->>'analysis_text'
 or t->>'analysis_text_sha256' is distinct from r->>'analysis_text_sha256'
 or (select array_agg(key order by key) from jsonb_object_keys(t->'request_state')key) is distinct from array['analysis_text','review_alias']::text[]
 or t->>'request_sha256' is distinct from public.jls_restaurant_hash(v) then return false;end if;
 end loop;return true;
end $fn$;

create function public.save_jev_chill80_protocol(p_body jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' as $fn$
declare rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_body->>'status' is distinct from 'sealed_preparation_only' or p_body->>'supplier_calls' is distinct from '0'
 or p_body->'run_id' is distinct from 'null'::jsonb or p_body->'spending_authorization' is distinct from 'null'::jsonb
 then raise exception 'CHILL80_PREPARATION_ONLY';end if;
 rid=public.save_jls_snapshot_preparation((p_body->>'source_protocol_id')::uuid,'jev_chill_reanalysis80_protocol_v1',p_body,p_sha);
 if not public.check_jev_chill80(rid) then raise exception 'CHILL80_SOURCE_INCOMPATIBLE';end if;return rid;
end $fn$;

-- Defined now, but no consent/execution is created by this migration or preparation.
create function public.authorize_jev_chill80(p_protocol uuid,p_directive text,p_directive_sha text,p_code text) returns uuid
language plpgsql security invoker set search_path='' as $fn$
declare p public.analysis_jls_snapshot_preparations;v jsonb;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_snapshot_preparations where id=p_protocol for update;
 if not public.check_jev_chill80(p.id) then raise exception 'CHILL80_SOURCE_INCOMPATIBLE';end if;
 select id into rid from public.analysis_jls_snapshot_preparations where protocol_id=p.protocol_id and kind='jev_chill80_execution_v1';
 if rid is not null then return rid;end if;
 if p_directive is null or p_code is null or p_code!~'^[0-9a-f]{40}$' or length(p_directive)<200
 or position('GO' in p_directive)=0 or position(p.id::text in p_directive)=0
 or p_directive_sha is distinct from encode(extensions.digest(p_directive,'sha256'),'hex') then raise exception 'CHILL80_NEW_SPECIFIC_GO_REQUIRED';end if;
 v=jsonb_build_object('version','jev-chill80-execution-v1','full_protocol_id',p.id,'protocol_sha256',p.sha256,
 'configuration_sha256',p.body->>'configuration_sha256','pending_sha256',p.body->>'pending_sha256','reuses_sha256',p.body->>'reuses_sha256',
 'scope',p.body->'policy','consent_source','user_directive_codex_delegation','directive',p_directive,'directive_sha256',p_directive_sha,
 'operator_identity',jsonb_build_object('kind','codex_admin','channel','supabase_mcp','database_role',current_user),
 'authority_user_id',p.body->>'authority_user_id','requested_at',now(),'expires_at',now()+interval '24 hours','executor_code_commit',p_code);
 return public.save_jls_snapshot_preparation(p.protocol_id,'jev_chill80_execution_v1',v,public.jls_restaurant_hash(v));
end $fn$;

create function public.reserve_jev_chill80(p_execution uuid,p_review uuid,p_request_sha text,p_worker text) returns uuid
language plpgsql security invoker set search_path='' as $fn$
declare e public.analysis_jls_snapshot_preparations;p public.analysis_jls_snapshot_preparations;r jsonb;v jsonb;rid uuid;i int;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into e from public.analysis_jls_snapshot_preparations where id=p_execution for update;
 if e.kind is distinct from 'jev_chill80_execution_v1' or e.sha256 is distinct from public.jls_restaurant_hash(e.body)
 or (e.body->>'expires_at')::timestamptz<=now() then raise exception 'CHILL80_GO_INVALID_OR_EXPIRED';end if;
 select * into p from public.analysis_jls_snapshot_preparations where id=(e.body->>'full_protocol_id')::uuid;
 if not public.check_jev_chill80(p.id) or e.body->>'protocol_sha256' is distinct from p.sha256 or e.protocol_id is distinct from p.protocol_id
 or e.body->'scope' is distinct from p.body->'policy' or e.body->>'pending_sha256' is distinct from p.body->>'pending_sha256'
 or e.body->>'reuses_sha256' is distinct from p.body->>'reuses_sha256' or e.body->>'consent_source' is distinct from 'user_directive_codex_delegation'
 or exists(select 1 from public.analysis_jls_snapshot_preparations a where a.protocol_id=p.protocol_id and a.kind~'^jev_chill80_result_[0-9]{2}$' and a.body->>'status' is distinct from 'completed')
 then raise exception 'CHILL80_INCOMPATIBLE_OR_STOPPED';end if;
 select value into r from jsonb_array_elements(p.body->'pending') where value->>'review_id'=p_review::text;
 if r is null or p_request_sha is distinct from r->>'request_sha256' or p_worker is null or length(p_worker)<10 then raise exception 'CHILL80_REQUEST_INVALID';end if;
 i=(r->>'position')::int;
 if exists(select 1 from generate_series(1,i-1)n where not exists(select 1 from public.analysis_jls_snapshot_preparations a where a.protocol_id=p.protocol_id and a.kind='jev_chill80_result_'||lpad(n::text,2,'0') and a.body->>'status'='completed')) then return null;end if;
 v=jsonb_build_object('version','jev-chill80-attempt-v1','execution_id',e.id,'full_protocol_id',p.id,'protocol_sha256',p.sha256,
 'review_id',p_review,'position',i,'request_sha256',p_request_sha,'request_raw_sha256',r->>'request_raw_sha256',
 'requested_model','jev-latest','required_served_model','jev-1.13.0','configuration_sha256',p.body->>'configuration_sha256',
 'worker',p_worker,'reserved_at',now(),'attempt_count',1,'uncertain_dispatch_is_consumed',true);
 insert into public.analysis_jls_snapshot_preparations(organization_id,protocol_id,kind,body,sha256)
 values(p.organization_id,p.protocol_id,'jev_chill80_attempt_'||lpad(i::text,2,'0'),v,public.jls_restaurant_hash(v))
 on conflict(protocol_id,kind) do nothing returning id into rid;return rid;
end $fn$;

create function public.wake_jev_chill80(p_execution uuid) returns bigint language plpgsql security invoker set search_path='' as $fn$
declare e public.analysis_jls_snapshot_preparations;n bigint;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into e from public.analysis_jls_snapshot_preparations where id=p_execution;
 if e.kind is distinct from 'jev_chill80_execution_v1' or e.sha256 is distinct from public.jls_restaurant_hash(e.body) then raise exception 'CHILL80_GO_REQUIRED';end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-jls-restaurant',
 headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
 body:=jsonb_build_object('mode','jev_chill80','execution_id',e.id),timeout_milliseconds:=1000) into n;return n;
end $fn$;

revoke all on function public.check_jev_chill80(uuid),public.save_jev_chill80_protocol(jsonb,text),public.authorize_jev_chill80(uuid,text,text,text),public.reserve_jev_chill80(uuid,uuid,text,text),public.wake_jev_chill80(uuid) from public,anon,authenticated;
grant execute on function public.check_jev_chill80(uuid),public.save_jev_chill80_protocol(jsonb,text),public.authorize_jev_chill80(uuid,text,text,text),public.reserve_jev_chill80(uuid,uuid,text,text),public.wake_jev_chill80(uuid) to service_role;
