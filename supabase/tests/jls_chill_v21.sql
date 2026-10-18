-- Invoke under service_role inside BEGIN/ROLLBACK, after setting
-- jls.v2_test_protocol to the result of save_jls_chill_v21_protocol.
-- Then include jls_contract_v2.sql for durable reservation / receipt / RLS tests.
do $fn$
declare p public.analysis_jls_contract_v2_protocols;bad jsonb;rid uuid;source_body jsonb;cache_id uuid;
begin
 select * into p from public.analysis_jls_contract_v2_protocols where id=current_setting('jls.v2_test_protocol')::uuid;
 if p.body->>'version'<>'jls-chill-targeted-v2.1-delegated-vi-v1' or p.source_archive_id is not null
 or p.source_snapshot_archive_id is distinct from (p.body->>'source_archive_id')::uuid
 or jsonb_array_length(p.body->'plan'->'cache_fingerprints')<>80
 or not public.check_jls_contract_v2_sources(p.id) then raise exception 'TEST_CHILL_SOURCE_FK';end if;
 rid=public.save_jls_chill_v21_protocol(p.body,p.sha256);
 if rid<>p.id then raise exception 'TEST_CHILL_PREPARATION_IDEMPOTENCE';end if;
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_set(p.body,'{configuration,max_luna_calls}','2'),
  jsonb_set(p.body,'{plan,config,confidence_min}','0.01'),
  jsonb_set(p.body,'{plan,luna_groups,0,request_sha256}','"changed"'),
  jsonb_set(p.body,'{branches,0,draft,request,model}','"wrong-model"'),
  jsonb_set(p.body,'{candidate_evidence_id}','"7f9809ab307f386b177babd74a39a547dbaf1fecc46354808da6a36755d811e8"')
 )) loop
  begin
   perform public.save_jls_chill_v21_protocol(bad,public.jls_restaurant_hash(bad));
   raise exception 'TEST_CHILL_CHANGED_INPUT_ACCEPTED';
  exception when others then if sqlerrm='TEST_CHILL_CHANGED_INPUT_ACCEPTED' then raise;end if;end;
 end loop;
 if has_function_privilege('authenticated','public.save_jls_chill_v21_protocol(jsonb,text)','EXECUTE')
 or has_function_privilege('anon','public.save_jls_chill_v21_protocol(jsonb,text)','EXECUTE') then raise exception 'TEST_CHILL_SERVER_WRITES_ONLY';end if;
 select body into source_body from public.analysis_jls_sol_ready_artifacts where id=p.source_artifact_id;
 if not public.check_jls_chill_v21_immutable_sources(source_body)
 or public.check_jls_chill_v21_immutable_sources(jsonb_set(source_body,'{plan,cache_fingerprints,0,response_sha256}','"changed"'))
 then raise exception 'TEST_CHILL_SEALED_MANIFEST_BINDING';end if;
 cache_id=(source_body->'plan'->'cache_fingerprints'->0->>'cache_id')::uuid;
 begin
  update public.analysis_jev_review_cache set theme_results='{}' where id=cache_id;
  raise exception 'TEST_COMPLETED_CACHE_MUTABLE';
 exception when others then if sqlerrm<>'ECONOMY_CACHE_IMMUTABLE' then raise;end if;end;
end $fn$;
