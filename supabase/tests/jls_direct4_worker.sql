-- Read-only SQL qualification. No consent, run, task or provider call is created.
begin;
do $$ declare x record;begin
 for x in select c.oid,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in('analysis_jls_restaurant_protocols','analysis_jls_restaurant_runs',
 'analysis_jls_restaurant_tasks','analysis_jls_restaurant_artifacts','analysis_jls_sol_ready_artifacts','analysis_jls_sol_ready_operations') loop
  if not (select relrowsecurity from pg_class where oid=x.oid) then raise exception 'RLS_MISSING %',x.relname;end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename=x.relname and cmd='SELECT' and qual like '%organization_members%')
  or exists(select 1 from pg_policies where schemaname='public' and tablename=x.relname and cmd<>'SELECT') then raise exception 'RLS_SCOPE_CHANGED %',x.relname;end if;
 end loop;
 for x in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in(
 'check_jls_direct4_sources','save_jls_direct4_protocol','authorize_jls_direct4','stage_jls_direct4','check_jls_direct4_ready_sources','save_jls_direct4_ready') loop
  if has_function_privilege('anon',x.oid,'execute') or has_function_privilege('authenticated',x.oid,'execute')
  or not has_function_privilege('service_role',x.oid,'execute') then raise exception 'WRITE_ACCESS_CHANGED %',x.proname;end if;
 end loop;
 if not exists(select 1 from pg_constraint where conrelid='public.analysis_jls_restaurant_runs'::regclass and contype='u'
 and pg_get_constraintdef(oid) like '%protocol_id%') then raise exception 'RUN_IDEMPOTENCE_MISSING';end if;
 if position('request_count' in pg_get_functiondef('public.claim_jls_restaurant_task(uuid,text)'::regprocedure))=0
 then raise exception 'RESERVATION_GUARD_MISSING';end if;
 if not exists(select 1 from pg_constraint where conrelid='public.analysis_jls_restaurant_protocols'::regclass
 and conname='analysis_jls_restaurant_protocols_establishment_id_check' and pg_get_constraintdef(oid) like '%jls-direct4-execution-v1%'
 and pg_get_constraintdef(oid) like '%jls-historical-snapshot-v2-vi-v1%') then raise exception 'DIRECT4_TABLE_SCOPE_MISSING';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
do $$ begin
 if exists(select 1 from public.analysis_jls_restaurant_protocols where body->>'version'='jls-direct4-execution-v1')
 or exists(select 1 from public.analysis_jls_restaurant_runs) then raise exception 'CROSS_ORG_READ';end if;
end $$;
reset role;
set local role service_role;
do $$ declare p public.analysis_jls_restaurant_protocols;n bigint;begin
 select * into p from public.analysis_jls_restaurant_protocols where body->>'version'='jls-direct4-execution-v1' order by created_at desc limit 1;
 if p.id is null or not public.check_jls_direct4_sources(p.body) then raise exception 'DIRECT4_SOURCES_INVALID';end if;
 if public.check_jls_direct4_sources(jsonb_set(p.body,'{max_luna_calls}','33'))
 or public.check_jls_direct4_sources(jsonb_set(p.body,'{preparation_sha256}',to_jsonb(repeat('0',64)))) then raise exception 'DIRECT4_MUTATION_ACCEPTED';end if;
 select count(*) into n from public.analysis_jls_restaurant_runs where protocol_id=p.id;
 if n<>0 then raise exception 'UNEXPECTED_PAID_RUN';end if;
 begin
  perform public.authorize_jls_restaurant(p.id,null,null);
  raise exception 'MISSING_CONSENT_ACCEPTED';
 exception when others then
  if sqlerrm not in('DIRECT4_DEPLOYED_QUALIFICATION_REQUIRED','DIRECT4_GO_SCOPE_CHANGED','JLS_NEW_GO_REQUIRED') then raise;end if;
 end;
 if (select count(*) from public.analysis_jls_restaurant_runs where protocol_id=p.id)<>n then raise exception 'UNEXPECTED_RUN_CREATED';end if;
end $$;
rollback;
