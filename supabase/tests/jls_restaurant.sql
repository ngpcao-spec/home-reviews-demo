-- Run inside an explicit transaction and ROLLBACK. No wake/provider invocation.
do $$declare p uuid;r uuid;again uuid;b jsonb;c jsonb;s text;org uuid;u uuid;e uuid='d40d3438-79d8-4c28-8b09-eba640598201';begin
 select organization_id into org from public.establishments where id=e;
 select user_id into u from public.organization_members where organization_id=org and role='owner' limit 1;
 b=jsonb_build_object('version','SYNTHETIC_SQL_TEST','configuration_sha256',repeat('a',64),'max_jev_calls',0,'max_luna_calls',32,'pending','[]'::jsonb);
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256) values(org,e,u,b,public.jls_restaurant_hash(b)) returning id into p;
 perform set_config('jls.test_protocol',p::text,true);perform set_config('jls.test_org',org::text,true);perform set_config('jls.test_user',u::text,true);
 c=jsonb_build_object('protocol_sha256',public.jls_restaurant_hash(b),'consent_source','user_directive_codex_delegation',
 'operator_identity',jsonb_build_object('kind','codex_admin','channel','supabase_mcp'),'user_directive','SYNTHETIC TRANSACTION TEST ONLY',
 'directive_sha256',encode(extensions.digest('SYNTHETIC TRANSACTION TEST ONLY','sha256'),'hex'),'requested_at',now(),'expires_at',now()+interval '1 hour',
 'scope',jsonb_build_object('establishment_id',e,'organization_id',org,'language','vi','configuration_sha256',repeat('a',64),
 'max_jev_calls',0,'max_luna_calls',32,'max_sol_calls',1,'automatic_retry',false,'provider_client_retries',0,'apify_calls',0));
 begin perform public.authorize_jls_restaurant(p,c||'{"consent_source":"not_a_GO"}',public.jls_restaurant_hash(c||'{"consent_source":"not_a_GO"}'));raise exception 'TEST_FAILED_NO_GO';exception when others then if sqlerrm='TEST_FAILED_NO_GO' then raise;end if;end;
 begin perform public.authorize_jls_restaurant(p,c||jsonb_build_object('expires_at',now()-interval '1 hour'),public.jls_restaurant_hash(c||jsonb_build_object('expires_at',now()-interval '1 hour')));raise exception 'TEST_FAILED_EXPIRED';exception when others then if sqlerrm='TEST_FAILED_EXPIRED' then raise;end if;end;
 r=public.authorize_jls_restaurant(p,c,public.jls_restaurant_hash(c));again=public.authorize_jls_restaurant(p,c,public.jls_restaurant_hash(c));
 if again<>r or (select count(*) from public.analysis_jls_restaurant_runs where protocol_id=p)<>1 then raise exception 'TEST_DUPLICATE_RUN';end if;
 if not public.claim_jls_restaurant_tick(r,'worker_a') or public.claim_jls_restaurant_tick(r,'worker_b') then raise exception 'TEST_CONCURRENT_LEASE';end if;
 begin update public.analysis_jls_restaurant_protocols set body='{}' where id=p;raise exception 'TEST_PROTOCOL_MUTABLE';exception when others then if sqlerrm='TEST_PROTOCOL_MUTABLE' then raise;end if;end;
 s=public.jls_restaurant_hash('{"synthetic":true}');if not public.save_jls_restaurant_artifact(r,'worker_a','mock','{"synthetic":true}',s)
 or not public.save_jls_restaurant_artifact(r,'worker_a','mock','{"synthetic":true}',s)
 or public.save_jls_restaurant_artifact(r,'worker_a','mock','{"synthetic":false}',public.jls_restaurant_hash('{"synthetic":false}')) then raise exception 'TEST_ARTIFACT_IDEMPOTENCE';end if;
 if public.stage_jls_restaurant(r,'worker_a','sol','[]') then raise exception 'TEST_PHASE_BYPASS';end if;
 perform public.release_jls_restaurant_tick(r,'worker_a','SYNTHETIC_STOP');
 if public.claim_jls_restaurant_tick(r,'worker_b') then raise exception 'TEST_TERMINAL_REOPENED';end if;
end $$;
-- Exercise the permanent-cache reservation and consumed-attempt guard with
-- synthetic text only. These rows are ROLLED BACK; never invoke a wake.
do $$declare org uuid=current_setting('jls.test_org')::uuid;u uuid=current_setting('jls.test_user')::uuid;
 e uuid='d40d3438-79d8-4c28-8b09-eba640598201';rid uuid;p uuid;r uuid;b jsonb;c jsonb;ident jsonb;payload jsonb;t jsonb;cfg public.analysis_jev_economy_configurations;begin
 select id into rid from public.reviews where establishment_id=e limit 1;
 select * into cfg from public.analysis_jev_economy_configurations where id='v12_economy_1pass_v1';
 ident=jsonb_build_object('organization_id',org,'establishment_id',e,'review_id',rid,
 'analysis_text_sha256',encode(extensions.digest('SYNTHETIC RESERVATION TEST ONLY','sha256'),'hex'),
 'configuration_id',cfg.id,'instruction_version',cfg.config->>'instruction_version','instruction_sha256',cfg.instruction_sha256,
 'threshold_version',cfg.config->>'threshold_version','threshold_sha256',cfg.threshold_sha256,'requested_model','jev-latest','expected_served_model','jev-1.13.0');
 payload=jsonb_build_object('model','jev-latest','state',jsonb_build_object('review_alias','mock','analysis_text','SYNTHETIC RESERVATION TEST ONLY'),'questions',cfg.config->'questions');
 b=jsonb_build_object('version','SYNTHETIC_RESERVATION_TEST','configuration_sha256',repeat('b',64),'max_jev_calls',1,'max_luna_calls',32,
 'configuration',jsonb_build_object('jev_request_template',jsonb_build_object('questions',cfg.config->'questions')),
 'pending',jsonb_build_array(jsonb_build_object('review_id',rid,'identity',ident,'payload',payload-'questions','request_sha256',public.jls_restaurant_hash(payload))));
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256)
 values(org,e,u,b,public.jls_restaurant_hash(b)) returning id into p;
 c=jsonb_build_object('protocol_sha256',public.jls_restaurant_hash(b),'consent_source','user_directive_codex_delegation',
 'operator_identity',jsonb_build_object('kind','codex_admin','channel','supabase_mcp'),'user_directive','SYNTHETIC TRANSACTION TEST ONLY',
 'directive_sha256',encode(extensions.digest('SYNTHETIC TRANSACTION TEST ONLY','sha256'),'hex'),'requested_at',now(),'expires_at',now()+interval '1 hour',
 'scope',jsonb_build_object('establishment_id',e,'organization_id',org,'language','vi','configuration_sha256',repeat('b',64),
 'max_jev_calls',1,'max_luna_calls',32,'max_sol_calls',1,'automatic_retry',false,'provider_client_retries',0,'apify_calls',0));
 r=public.authorize_jls_restaurant(p,c,public.jls_restaurant_hash(c));
 if not public.claim_jls_restaurant_tick(r,'mock_worker') then raise exception 'TEST_TICK';end if;
 t=public.claim_jls_restaurant_task(r,'mock_worker');
 if t is null or (t->>'request_count')::int<>1 or t->>'status'<>'running'
 or not exists(select 1 from public.analysis_jev_review_cache where id=(t->>'cache_id')::uuid and status='dispatched')
 then raise exception 'TEST_ATOMIC_CACHE_RESERVATION';end if;
 if public.claim_jls_restaurant_task(r,'mock_worker') is not null then raise exception 'TEST_SECOND_ATTEMPT';end if;
 begin update public.analysis_jls_restaurant_tasks set request_count=0,status='pending' where id=(t->>'id')::uuid;raise exception 'TEST_ATTEMPT_RESET';exception when others then if sqlerrm='TEST_ATTEMPT_RESET' then raise;end if;end;
 update public.analysis_jls_restaurant_runs set lease_until=now()-interval '1 minute' where id=r;
 if public.claim_jls_restaurant_tick(r,'other_worker') then raise exception 'TEST_LOST_ATTEMPT_RETRIED';end if;
 if not exists(select 1 from public.analysis_jls_restaurant_runs where id=r and status='billing_uncertain') then raise exception 'TEST_AMBIGUITY_NOT_BLOCKED';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('jls.test_user'),'role','authenticated')::text,true);
do $$begin
 if (select count(*) from public.analysis_jls_restaurant_protocols where id=current_setting('jls.test_protocol')::uuid)<>1 then raise exception 'TEST_OWNER_READ';end if;
 begin perform public.authorize_jls_restaurant(current_setting('jls.test_protocol')::uuid,'{}','');raise exception 'TEST_BROWSER_WRITE';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$begin if exists(select 1 from public.analysis_jls_restaurant_protocols where id=current_setting('jls.test_protocol')::uuid) then raise exception 'TEST_CROSS_TENANT';end if;end $$;
set local role anon;
do $$begin begin perform count(*) from public.analysis_jls_restaurant_protocols;raise exception 'TEST_ANON_READ';exception when insufficient_privilege then null;end;end $$;
reset role;
select 'SQL/RLS: no GO, expiry, uniqueness, leases, immutable artifact, idempotence, phase gate, owner read, cross tenant, anon deny: PASS' as checks;
