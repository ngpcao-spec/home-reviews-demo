CREATE OR REPLACE FUNCTION public.check_jls_sol_ready_sources(p_body jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare p public.analysis_jls_restaurant_protocols;r public.analysis_jls_restaurant_runs;x jsonb;t public.analysis_jls_restaurant_tasks;a public.analysis_jls_restaurant_artifacts;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=(p_body->>'source_protocol_id')::uuid;
 select * into r from public.analysis_jls_restaurant_runs where id=(p_body->>'source_run_id')::uuid;
 if p.id is null or r.protocol_id<>p.id or r.status<>'blocked' or p.sha256<>p_body->>'source_protocol_sha256'
 or jsonb_array_length(p_body->'source_tasks')<>28
 or jsonb_array_length(p_body->'decisions')<>32 or p_body->>'decisions_sha256'<>public.jls_restaurant_hash(p_body->'decisions')
 or exists(select 1 from jsonb_array_elements(p.body->'cache') cache_entry(value) left join public.analysis_jev_review_cache c on c.id=(cache_entry.value->>'id')::uuid where c.id is null or c.status<>'completed' or c.organization_id<>p.organization_id or c.establishment_id<>p.establishment_id or to_jsonb(c)<>cache_entry.value)
 or exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=r.id and phase='sol')
 or not exists(select 1 from public.analysis_jls_restaurant_artifacts d where d.run_id=r.id and d.kind='luna_decisions'
 and d.sha256=p_body->>'source_decisions_artifact_sha256' and d.sha256=public.jls_restaurant_hash(d.body)
 and d.body->>'decisions_sha256'=p_body->>'decisions_sha256') then return false;end if;
 for x in select value from jsonb_array_elements(p_body->'source_tasks') loop
 select * into t from public.analysis_jls_restaurant_tasks where id=(x->>'task_id')::uuid;
 select * into a from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='task:'||t.id;
 if t.id is null or t.run_id<>r.id or t.organization_id<>r.organization_id or t.phase<>'luna' or t.status<>'completed' or t.request_count<>1
 or t.review_id::text<>x->>'review_id' or t.request_sha256<>x->>'request_sha256' or t.request_sha256<>public.jls_restaurant_hash(t.request)
 or a.sha256 is distinct from x->>'artifact_sha256' or a.sha256<>public.jls_restaurant_hash(a.body)
 or a.body->>'response_sha256' is distinct from x->>'response_sha256'
 or a.body->>'response_sha256'<>public.jls_restaurant_hash(a.body->'response') then return false;end if;
 end loop;return true;end $function$;
