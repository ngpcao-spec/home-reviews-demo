-- Reusing an exact completed receipt is not a repeat of an unknown supplier
-- attempt. Keep old uncertain cache rows and their history; copy the later
-- compatible immutable receipt into the new task instead. No provider send.
do $$declare d text;a text;b text;begin
 d=pg_get_functiondef('public.claim_parallel_report_task(uuid,text)'::regprocedure);
 a=';handoff jsonb;begin';if position(a in d)=0 then raise exception 'CACHE_CLAIM_DECLARATION_CHANGED';end if;
 d=replace(d,a,';handoff jsonb;saved jsonb;saved_sha text;manifest jsonb;handled int=0;begin');
 a=' loop'||chr(10)||'  select * into t';if position(a in d)=0 then raise exception 'CACHE_CLAIM_LOOP_CHANGED';end if;
 d=replace(d,a,' select jsonb_object_agg(x->>''review_id'',jsonb_build_object(''request_sha256'',x->>''request_sha256'',''identity'',x->''identity'')) into manifest from jsonb_array_elements(p.body->''pending'') x;
 loop
  if handled>=64 then return null;end if;
  handled=handled+1;
  select * into t');
 a='if not exists(select 1 from jsonb_array_elements(p.body->''pending'') x where x->>''review_id''=t.review_id::text and x->>''request_sha256''=t.request_sha256 and x->''identity''=t.identity)';
 if position(a in d)=0 then raise exception 'CACHE_MANIFEST_CHECK_CHANGED';end if;
 d=replace(d,a,'if (manifest->t.review_id::text) is distinct from jsonb_build_object(''request_sha256'',t.request_sha256,''identity'',t.identity)');
 a='   if public.parallel_prior_attempt_conflict(r.id,t.id) then raise exception ''PARALLEL_PREVIOUS_OUTCOME_UNCERTAIN'';end if;';
 if position(a in d)=0 then raise exception 'CACHE_PRIOR_GUARD_CHANGED';end if;d=replace(d,a,'');
 a='   if c.task_id<>t.id or c.status<>''reserved'' then';
 if position(a in d)=0 then raise exception 'CACHE_HANDOFF_CHANGED';end if;
 b='   saved=null;saved_sha=null;
   select a.body,a.sha256 into saved,saved_sha
   from public.analysis_jls_restaurant_tasks oldt join public.analysis_jls_restaurant_runs oldr on oldr.id=oldt.run_id
   join public.analysis_jls_restaurant_protocols oldp on oldp.id=oldr.protocol_id
   join public.analysis_jls_restaurant_artifacts a on a.run_id=oldt.run_id and a.kind=''task:''||oldt.id
   where oldt.run_id<>r.id and oldt.organization_id=r.organization_id and oldp.establishment_id=p.establishment_id
   and oldt.review_id=t.review_id and oldt.phase=''jev'' and oldt.status=''completed''
   and oldt.identity=t.identity and oldt.request_sha256=t.request_sha256
   and oldp.body->>''classification_configuration_sha256''=p.body->>''classification_configuration_sha256''
   and a.body#>>''{direct4_result,model}''=''jev-1.13.0'' and a.sha256=public.jls_restaurant_hash(a.body)
   and oldr.consent->>''consent_source''<>''technical_qualification_no_spending'' and not public.is_jls_sql_qualification(oldr.id)
   order by oldt.completed_at desc limit 1;
   if saved is not null then
    insert into public.analysis_jls_restaurant_artifacts(run_id,organization_id,kind,body,sha256) values(r.id,r.organization_id,''task:''||t.id,saved,saved_sha) on conflict do nothing;
    update public.analysis_jls_restaurant_tasks set status=''reused'',completed_at=now() where id=t.id;continue;
   end if;
   if public.parallel_prior_attempt_conflict(r.id,t.id) then raise exception ''PARALLEL_PREVIOUS_OUTCOME_UNCERTAIN'';end if;
'||a;d=replace(d,a,b);execute d;
end $$;
