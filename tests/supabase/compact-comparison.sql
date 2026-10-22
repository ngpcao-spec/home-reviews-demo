-- Inject only a PRIVATE fixture generated with --deny-net. Every inserted
-- protocol, qualification, run, task, receipt and result is rolled back.
begin;
set local role service_role;
-- PRIVATE_FIXTURE
do $$declare f jsonb=current_setting('test.compact_fixture')::jsonb;b jsonb=f#>'{protocol,body}';pid uuid;rid uuid;op uuid;c jsonb;v jsonb;t timestamptz=clock_timestamp();n int=0;begin
 assert public.check_jls_compact_comparison(b),'real-source check failed';n=n+1;
 assert not public.check_jls_compact_comparison(jsonb_set(b,'{establishment_id}',to_jsonb(gen_random_uuid()::text))),'cross-establishment accepted';n=n+1;
 assert not public.check_jls_compact_comparison(jsonb_set(b,'{organization_id}',to_jsonb(gen_random_uuid()::text))),'cross-organization accepted';n=n+1;
 assert not public.check_jls_compact_comparison(jsonb_set(b,'{max_sol_calls}','2')),'extra Sol call accepted';n=n+1;
 assert not public.check_jls_compact_comparison(jsonb_set(b,'{ready_template,draft,packet,associations,0,ref}','"e999"')),'changed mapping accepted';n=n+1;
 assert not has_function_privilege('anon','public.authorize_jls_compact_comparison(uuid,jsonb,text)','execute'),'anon authorization allowed';
 assert not has_function_privilege('authenticated','public.save_jls_compact_comparison(jsonb,text)','execute'),'client protocol writes allowed';n=n+2;
 pid=public.save_jls_compact_comparison(b,public.jls_restaurant_hash(b));
 assert pid=public.save_jls_compact_comparison(b,public.jls_restaurant_hash(b)),'protocol not idempotent';n=n+1;
 c=jsonb_set(b,'{code_provenance}',to_jsonb(repeat('0',40)));
 assert pid=public.save_jls_compact_comparison(c,public.jls_restaurant_hash(c)),'same frozen trial duplicated';n=n+1;
 begin
  perform public.authorize_jls_compact_comparison(pid,'{}','bad');raise exception 'MISSING_GO_ACCEPTED';
 exception when raise_exception then
  if sqlerrm<>'COMPACT_COMPARISON_DEPLOYED_PROBE_REQUIRED' then raise;end if;
 end;n=n+1;
 rid=public.prepare_jls_candidates_qualification(pid,'compact_sql_rollback_v1');
 select id into op from public.analysis_jls_sol_ready_operations where run_id=rid;
 assert op is not null,'shared Sol operation missing';
 assert not exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=rid and phase in('jev','luna')),'new JEV/Luna task created';n=n+2;
 c=public.claim_jls_sol_ready(op,'sql_dispatch');
 assert c->>'request_count'='1' and c->>'mode'='mock','shared reservation failed';n=n+1;
 assert public.claim_jls_sol_ready(op,'concurrent_dispatch') is null,'concurrent claim accepted';n=n+1;
 assert public.receive_jls_sol_ready(op,'sql_dispatch',f->'receipt',public.jls_restaurant_hash(f->'receipt')),'raw receipt save failed';n=n+1;
 c=public.claim_jls_sol_ready(op,'sql_validate');assert c->>'phase'='validate_sol','validation claim missing';n=n+1;
 assert public.finish_jls_sol_ready(op,'sql_validate','completed',f->'result',public.jls_restaurant_hash(f->'result')),'shared finalization failed';n=n+1;
 assert public.claim_jls_sol_ready(op,'repeat_wake') is null,'terminal job retried';n=n+1;
 select result into v from public.analysis_jls_sol_ready_operations where id=op;
 assert v#>>'{validated_report,response_format_version}'='jls-direct4-compact-sol-v1','reconstructed compact result not saved';n=n+1;
 assert (select request_count from public.analysis_jls_sol_ready_operations where id=op)=1,'attempt count changed';n=n+1;
 assert public.check_jls_candidates_sources((select body from public.analysis_jls_restaurant_protocols where id=(b->'source'->>'source_protocol_id')::uuid)) is not true,'unrelated protocol accepted as candidate';n=n+1;
 perform set_config('test.compact_result',jsonb_build_object('assertions',n,'provider_calls',0,'mode','mock','sql_wall_ms',extract(epoch from clock_timestamp()-t)*1000,'rollback',true)::text,true);
end $$;
select current_setting('test.compact_result')::jsonb as sql_qualification;
rollback;
