-- Execute within BEGIN/ROLLBACK with a FREE protocol fixture. No valid consent
-- is recorded, no run/task is inserted, no HTTP wake/provider is invoked.
do $$ declare t text;fn text;begin
 foreach t in array array['analysis_jls_prioritized_protocols','analysis_jls_prioritized_runs','analysis_jls_prioritized_tasks','analysis_jls_prioritized_results','analysis_jls_prioritized_events'] loop
  if not(select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'RLS_MISSING';end if;
  if has_table_privilege('authenticated','public.'||t,'insert') or has_table_privilege('authenticated','public.'||t,'update') or has_table_privilege('anon','public.'||t,'select') then raise exception 'UNSAFE_TABLE_GRANT';end if;
 end loop;
 foreach fn in array array['jls_pri_source_check(bigint,boolean)','save_jls_pri_protocol(jsonb,text)','jls_pri_authorize(uuid,text,jsonb)','claim_jls_pri_task(uuid,text)','finish_jls_pri_task(uuid,text,text,jsonb,text)','jls_pri_wake(uuid)'] loop
  if has_function_privilege('authenticated','public.'||fn,'execute') or has_function_privilege('anon','public.'||fn,'execute') then raise exception 'PUBLIC_WRITE_ENDPOINT';end if;
 end loop;
end $$;
set local role service_role;
do $$ declare p public.analysis_jls_prioritized_protocols;bad jsonb;blocked boolean;scope jsonb;before_runs bigint;before_tasks bigint;begin
 select * into p from public.analysis_jls_prioritized_protocols limit 1;
 if p.id is null then raise exception 'FREE_PROTOCOL_FIXTURE_REQUIRED';end if;
 select count(*) into before_runs from public.analysis_jls_prioritized_runs;select count(*) into before_tasks from public.analysis_jls_prioritized_tasks;
 if public.save_jls_pri_protocol(p.body,p.sha256)<>p.id then raise exception 'IDEMPOTENCE_FAILED';end if;
 blocked=false;
 begin perform public.jls_pri_authorize(p.id,p.sha256,'{}');exception when others then if sqlerrm<>'JLS_PRI_NEW_EXECUTION_GO_REQUIRED' then raise;end if;blocked=true;end;
 if not blocked then raise exception 'MISSING_GO_ALLOWED';end if;
 scope=jsonb_build_object('format_version',p.body->>'format_version','language','vi','requested_model','gpt-6.1-sol','endpoint','/v1/responses',
  'source_plan_id',p.body->>'source_plan_id','source_run_id',p.body->>'source_run_id','organization_id',p.organization_id::text,
  'request_sha256',p.body->>'request_sha256','preparation_sha256',p.body->>'preparation_sha256','decisions_sha256',p.body->>'decisions_sha256',
  'configuration_sha256',p.body->>'configuration_sha256','max_sol_calls',1,'jev_new_calls',0,'luna_new_calls',0,'apify_new_calls',0,'automatic_retry',false);
 -- Intentionally invalid expired MOCK directive: authorization rejects BEFORE insert.
 bad=jsonb_build_object('version',p.version,'protocol_sha256',p.sha256,'action','execute_prioritized_vi_sol_once','execution_authorized',true,
  'consent_source','user_directive_codex_delegation','operator_identity',p.body->'operator_identity','user_directive','EXPIRED MOCK DIRECTIVE FOR SQL TESTS ONLY',
  'directive_sha256',encode(extensions.digest('EXPIRED MOCK DIRECTIVE FOR SQL TESTS ONLY','sha256'),'hex'),'scope',scope,'approved_estimates',p.body->'estimates',
  'requested_at',now()-interval '48 hours','expires_at',now()-interval '24 hours');
 blocked=false;begin perform public.jls_pri_authorize(p.id,p.sha256,bad);exception when others then if sqlerrm<>'JLS_PRI_CONSENT_EXPIRED' then raise;end if;blocked=true;end;
 if not blocked then raise exception 'EXPIRED_GO_ALLOWED';end if;
 blocked=false;begin perform public.jls_pri_authorize(p.id,p.sha256,jsonb_set(bad,'{scope,language}','"fr"'));exception when others then if sqlerrm<>'JLS_PRI_NEW_EXECUTION_GO_REQUIRED' then raise;end if;blocked=true;end;
 if not blocked then raise exception 'WRONG_SCOPE_ALLOWED';end if;
 blocked=false;begin perform public.jls_pri_source_check(231);exception when others then if sqlerrm<>'JLS_PRI_SOURCE_CHANGED' then raise;end if;blocked=true;end;
 if not blocked then raise exception 'FRENCH_SOURCE_ALLOWED';end if;
 blocked=false;begin perform public.save_jls_pri_protocol(jsonb_set(p.body,'{request_sha256}','"changed"'),encode(extensions.digest(public.jev_economy_canonical(jsonb_set(p.body,'{request_sha256}','"changed"')),'sha256'),'hex'));exception when others then if sqlerrm<>'JLS_PRI_PROTOCOL_CHANGED' then raise;end if;blocked=true;end;
 if not blocked then raise exception 'TAMPER_ALLOWED';end if;
 if public.claim_jls_pri_task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','test') is not null then raise exception 'UNAUTHORIZED_CLAIM';end if;
 blocked=false;begin update public.analysis_jls_prioritized_protocols set sha256=repeat('0',64) where id=p.id;exception when others then if sqlerrm not like '%IMMUTABLE%' then raise;end if;blocked=true;end;
 if not blocked then raise exception 'PROTOCOL_MUTABLE';end if;
 if (select count(*) from public.analysis_jls_prioritized_runs)<>before_runs or (select count(*) from public.analysis_jls_prioritized_tasks)<>before_tasks then raise exception 'TEST_CREATED_EXECUTION';end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',true);
do $$ begin if exists(select 1 from public.analysis_jls_prioritized_protocols) then raise exception 'CROSS_TENANT_READ';end if;end $$;
reset role;
