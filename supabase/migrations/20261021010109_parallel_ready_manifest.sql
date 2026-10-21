-- Protocols and Sol-ready artifacts already have immutable database triggers.
-- Once sealed at start, use the immutable protocol/pair binding on task claims
-- instead of reserializing the entire historical report for every reservation.
do $$declare d text;begin
 select pg_get_functiondef('public.jls_restaurant_valid(uuid)'::regprocedure) into d;
 d=replace(d,'else p.sha256=public.jls_restaurant_hash(p.body) end',
 'else case when p.body->>''version''=''jls-direct4-parallel-no-luna-v1'' then exists(select 1 from public.analysis_parallel_reports pair where pair.protocol_id=p.id and pair.run_id=r.id and pair.organization_id=p.organization_id and pair.establishment_id=p.establishment_id and pair.corpus_sha256=p.body->''source_snapshot''->>''source_reviews_sha256'') else p.sha256=public.jls_restaurant_hash(p.body) end end');
 execute d;
 select pg_get_functiondef('public.prepare_parallel_ready(uuid,text,jsonb,text)'::regprocedure) into d;
 d=replace(d,'e jsonb;s jsonb;','e jsonb;s jsonb;k text;positives int;negatives int;');
 d=replace(d,'insert into public.analysis_jls_sol_ready_artifacts', $checks$
 if p_body->>'classification_sources_sha256' is distinct from public.jls_restaurant_hash(p_body->'classification_sources')
 or jsonb_array_length(p_body->'classification_sources')<>(p.body->'denominators'->>'analytical_reviews')::int
 or (select count(distinct value->>'review_id') from jsonb_array_elements(p_body->'classification_sources'))<>jsonb_array_length(p_body->'classification_sources') then raise exception 'PARALLEL_CLASSIFICATION_MANIFEST_CHANGED';end if;
 for e in select value from jsonb_array_elements(p_body->'classification_sources') loop
  if not exists(select 1 from public.analysis_jls_restaurant_tasks t join public.analysis_jls_restaurant_artifacts a on a.run_id=t.run_id and a.kind='task:'||t.id
   where t.id=(e->>'task_id')::uuid and t.run_id=r.id and t.phase='jev' and t.status in('completed','reused') and t.review_id::text=e->>'review_id'
   and a.sha256=e->>'artifact_sha256' and public.jls_restaurant_hash(a.body->'direct4_result')=e->>'result_sha256'
   and a.body->'direct4_result'->>'model'='jev-1.13.0') then raise exception 'PARALLEL_CLASSIFICATION_MANIFEST_CHANGED';end if;
 end loop;
 foreach k in array array['service','price','quality','ambiance'] loop
  select count(*) filter(where a.body->'direct4_result'->'categories'->k->>'native_choice' in('positive','mixed')),
   count(*) filter(where a.body->'direct4_result'->'categories'->k->>'native_choice' in('negative','mixed')) into positives,negatives
  from public.analysis_jls_restaurant_tasks t join public.analysis_jls_restaurant_artifacts a on a.run_id=t.run_id and a.kind='task:'||t.id where t.run_id=r.id and t.phase='jev' and t.status in('completed','reused');
  if positives<>(p_body->'statistics'->'counts'->'categories'->k->>'positive_including_mixed')::int or negatives<>(p_body->'statistics'->'counts'->'categories'->k->>'negative_including_mixed')::int then raise exception 'PARALLEL_SERVER_COUNTS_CHANGED';end if;
 end loop;
 insert into public.analysis_jls_sol_ready_artifacts
 $checks$);execute d;
end $$;
