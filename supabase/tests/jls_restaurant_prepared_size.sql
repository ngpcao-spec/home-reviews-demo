-- Synthetic SQL fixtures only, inside BEGIN/ROLLBACK; never wake a worker.
do $$declare org uuid;u uuid;p uuid;r uuid;b jsonb;c jsonb;policy jsonb;wire jsonb;draft jsonb;task jsonb;case_no int;ok boolean;
begin
 select organization_id into org from public.establishments where id='d40d3438-79d8-4c28-8b09-eba640598201';
 select user_id into u from public.organization_members where organization_id=org and role='owner' limit 1;
 policy=jsonb_build_object('version','jls-sol-envelope-32k-v1','input_budget_tokens',32768,'max_output_tokens',9500);
 for case_no in 1..4 loop
 b=jsonb_build_object('version','jls-restaurant-prepared-vi-v1','configuration_sha256',repeat('d',64),'max_jev_calls',0,'max_luna_calls',28,
 'pending','[]'::jsonb,'prepared',jsonb_build_object('version','SYNTHETIC_SQL_ONLY'),'sol_size_policy',policy,'synthetic_case',case_no);
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256)
 values(org,'d40d3438-79d8-4c28-8b09-eba640598201',u,b,public.jls_restaurant_hash(b)) returning id into p;
 c=jsonb_build_object('protocol_sha256',public.jls_restaurant_hash(b),'consent_source','user_directive_codex_delegation',
 'operator_identity',jsonb_build_object('kind','codex_admin','channel','supabase_mcp'),'user_directive','SYNTHETIC ROLLBACK SIZE TEST ONLY',
 'directive_sha256',encode(extensions.digest('SYNTHETIC ROLLBACK SIZE TEST ONLY','sha256'),'hex'),'requested_at',now(),'expires_at',now()+interval '1 hour',
 'scope',jsonb_build_object('establishment_id','d40d3438-79d8-4c28-8b09-eba640598201','organization_id',org,'language','vi',
 'configuration_sha256',repeat('d',64),'max_jev_calls',0,'max_luna_calls',28,'max_sol_calls',1,'automatic_retry',false,'provider_client_retries',0,'apify_calls',0));
 r=public.authorize_jls_restaurant(p,c,public.jls_restaurant_hash(c));
 if not public.claim_jls_restaurant_tick(r,'synthetic_size_worker') then raise exception 'TEST_SIZE_LEASE';end if;
 update public.analysis_jls_restaurant_runs set stage='prepare_sol' where id=r;
 wire=jsonb_build_object('model','gpt-6.1-sol','max_output_tokens',case when case_no=2 then 9501 else 9500 end);
 draft=jsonb_build_object('gate',jsonb_build_object('passed',true),'draft',jsonb_build_object('request',wire,'request_sha256',public.jls_restaurant_hash(wire),
 'estimates',jsonb_build_object('estimated_input_tokens',case when case_no=1 then 32769 else 200 end),
 'config',jsonb_build_object('sol_size_policy',case when case_no=3 then '{}'::jsonb else policy end)),
 'token_certificate','{}'::jsonb,'token_certificate_sha256',public.jls_restaurant_hash('{}'),
 'request_json',wire::text,'request_raw_sha256',encode(extensions.digest(wire::text,'sha256'),'hex'));
 if not public.save_jls_restaurant_artifact(r,'synthetic_size_worker','sol_dossier',draft,public.jls_restaurant_hash(draft)) then raise exception 'TEST_SIZE_ARTIFACT';end if;
 task=jsonb_build_array(jsonb_build_object('request',wire,'request_sha256',public.jls_restaurant_hash(wire)));
 ok=public.stage_jls_restaurant(r,'synthetic_size_worker','sol',task);
 if ok is distinct from (case_no=4) then raise exception 'TEST_PREPARED_SIZE_GUARD_%',case_no;end if;
 if exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=r and request_count<>0) then raise exception 'TEST_PROVIDER_ATTEMPT';end if;
 end loop;
end $$;
select 'prepared Sol SQL guard: input/output/policy mismatch rejected; valid request staged with zero attempts: PASS' checks;
