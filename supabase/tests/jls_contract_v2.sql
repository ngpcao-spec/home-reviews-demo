-- Real frozen dossier, explicit technical mocks in BEGIN/ROLLBACK only.
do $fn$declare p uuid=current_setting('jls.v2_test_protocol')::uuid;rowp public.analysis_jls_contract_v2_protocols;
 op uuid;o jsonb;again uuid;receipt jsonb;result jsonb;branch jsonb;g jsonb;bad jsonb;begin
 select * into rowp from public.analysis_jls_contract_v2_protocols where id=p;
 if not public.check_jls_contract_v2_sources(p) then raise exception 'TEST_SOURCE_COMPATIBILITY';end if;
 if exists(select 1 from public.analysis_jls_contract_v2_operations where protocol_id=p and mode='paid') then raise exception 'TEST_UNEXPECTED_PAID_OPERATION';end if;
 begin perform public.authorize_jls_contract_v2(p,null,null);raise exception 'TEST_ABSENT_GO_ACCEPTED';exception when others then if sqlerrm='TEST_ABSENT_GO_ACCEPTED' then raise;end if;end;
 -- Shape-only synthetic object. Never passed to authorization or written as consent.
 g=jsonb_build_object('protocol_id',p,'protocol_sha256',rowp.sha256,'consent_source','user_directive_codex_delegation',
 'operator_identity','{"kind":"codex_admin","channel":"supabase_mcp"}'::jsonb,'user_directive','EXPLICIT SYNTHETIC SHAPE TEST NOT A GO',
 'directive_sha256',encode(extensions.digest('EXPLICIT SYNTHETIC SHAPE TEST NOT A GO','sha256'),'hex'),'requested_at',now(),'expires_at',now()+interval '1 hour',
 'scope',jsonb_build_object('organization_id',rowp.organization_id,'establishment_id',rowp.establishment_id,'language','vi','configuration_sha256',rowp.body->>'configuration_sha256',
 'max_jev_calls',0,'max_luna_calls',1,'max_questions',1,'max_sol_calls',1,'apify_calls',0,'automatic_retry',false,'provider_client_retries',0));
 if not public.valid_jls_contract_v2_consent(p,g,public.jls_restaurant_hash(g)) then raise exception 'TEST_VALID_SCOPE_SHAPE';end if;
 for bad in select value from jsonb_array_elements(jsonb_build_array(g||jsonb_build_object('expires_at',now()-interval '1 hour'),
 jsonb_set(g,'{scope,max_luna_calls}','2'),jsonb_set(g,'{scope,language}','"fr"'),g||'{"protocol_id":"00000000-0000-4000-8000-000000000000"}')) loop
 if public.valid_jls_contract_v2_consent(p,bad,public.jls_restaurant_hash(bad)) then raise exception 'TEST_INVALID_SCOPE_SHAPE';end if;end loop;
 begin update public.analysis_jls_contract_v2_protocols set body='{}' where id=p;raise exception 'TEST_PROTOCOL_MUTABLE';exception when others then if sqlerrm='TEST_PROTOCOL_MUTABLE' then raise;end if;end;
 op=public.create_jls_contract_v2_probe(p,'ACCEPTED:sql_rollback_only');again=public.create_jls_contract_v2_probe(p,'ACCEPTED:sql_rollback_only');
 if op<>again then raise exception 'TEST_IDEMPOTENCE';end if;
 o=public.claim_jls_contract_v2(op,'sql_mock');
 if o->>'luna_count'<>'1' or o->>'sol_count'<>'0' or public.claim_jls_contract_v2(op,'concurrent') is not null then raise exception 'TEST_ATOMIC_RESERVATION';end if;
 receipt=jsonb_build_object('request_sha256',rowp.body->'luna_group'->>'request_sha256','request_raw_sha256',rowp.body->>'luna_request_raw_sha256',
 'mock',true,'http_status',200,'raw_response_text','EXPLICIT SQL MOCK','raw_response_sha256',encode(extensions.digest('EXPLICIT SQL MOCK','sha256'),'hex'));
 if not public.receive_jls_contract_v2(op,'sql_mock','luna',receipt,public.jls_restaurant_hash(receipt)) then raise exception 'TEST_LUNA_RECEIPT';end if;
 o=public.claim_jls_contract_v2(op,'sql_validate');select value into branch from jsonb_array_elements(rowp.body->'branches') where value->>'assumption'='ACCEPTED';
 result=jsonb_build_object('receipt_sha256',public.jls_restaurant_hash(receipt),'raw_response_sha256',receipt->>'raw_response_sha256','sol_gate',branch->'gate',
 'decisions',jsonb_build_array(jsonb_build_object('evidence_id',rowp.body->>'candidate_evidence_id','status','ACCEPTED','request_sha256',rowp.body->'luna_group'->>'request_sha256')));
 if not public.finish_jls_contract_v2_luna(op,'sql_validate',result,public.jls_restaurant_hash(result),'ACCEPTED') then raise exception 'TEST_LUNA_SAVE';end if;
 o=public.claim_jls_contract_v2(op,'sql_sol');if o->>'luna_count'<>'1' or o->>'sol_count'<>'1' then raise exception 'TEST_ONLY_ONE_SOL';end if;
 receipt=jsonb_build_object('request_sha256',branch->'draft'->>'request_sha256','request_raw_sha256',branch->>'request_raw_sha256',
 'mock',true,'http_status',200,'raw_response_text','EXPLICIT SQL MOCK SOL','raw_response_sha256',encode(extensions.digest('EXPLICIT SQL MOCK SOL','sha256'),'hex'));
 if not public.receive_jls_contract_v2(op,'sql_sol','sol',receipt,public.jls_restaurant_hash(receipt)) then raise exception 'TEST_SOL_RECEIPT';end if;
 o=public.claim_jls_contract_v2(op,'sql_validation');
 result=jsonb_build_object('receipt_sha256',public.jls_restaurant_hash(receipt),'raw_response_sha256',receipt->>'raw_response_sha256','explicit_sql_mock',true);
 if not public.finish_jls_contract_v2_sol(op,'sql_validation','completed',result,public.jls_restaurant_hash(result)) then raise exception 'TEST_FINAL_SAVE';end if;
 if public.claim_jls_contract_v2(op,'repeat') is not null then raise exception 'TEST_REDISPATCH';end if;
 begin update public.analysis_jls_contract_v2_operations set result='{}' where id=op;raise exception 'TEST_RESULT_MUTABLE';exception when others then if sqlerrm='TEST_RESULT_MUTABLE' then raise;end if;end;
 op=public.create_jls_contract_v2_probe(p,'ACCEPTED:lost_response_sql_only');o=public.claim_jls_contract_v2(op,'sql_lost');
 update public.analysis_jls_contract_v2_operations set lease_until=now()-interval '1 second' where id=op;
 o=public.claim_jls_contract_v2(op,'sql_retry');
 if o is not null or not exists(select 1 from public.analysis_jls_contract_v2_operations where id=op and luna_count=1 and status='billing_uncertain') then raise exception 'TEST_UNCERTAIN_RETRY';end if;
 if has_table_privilege('authenticated','public.analysis_jls_contract_v2_operations','INSERT') or has_function_privilege('authenticated','public.authorize_jls_contract_v2(uuid,jsonb,text)','EXECUTE')
 or has_table_privilege('anon','public.analysis_jls_contract_v2_protocols','SELECT') then raise exception 'TEST_ACCESS_GRANTS';end if;
end $fn$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
set local role authenticated;
do $fn$begin if exists(select 1 from public.analysis_jls_contract_v2_protocols) or exists(select 1 from public.analysis_jls_contract_v2_operations) or exists(select 1 from public.analysis_jls_contract_v2_checks) then raise exception 'TEST_CROSS_TENANT_READ';end if;end $fn$;
reset role;
