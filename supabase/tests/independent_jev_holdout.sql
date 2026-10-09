-- Read-only deployment checks. No real/synthetic run, task, annotation or provider request is created.
begin transaction read only;
do $$
declare t text;c jsonb;s jsonb;
begin
 foreach t in array array['analysis_jev_independent_configurations','analysis_jev_independent_runs','analysis_jev_independent_tasks','analysis_jev_independent_results'] loop
 if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'RLS missing: %',t;end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and roles=array['authenticated']::name[] and cmd='SELECT' and qual like '%organization_members%') then raise exception 'Authorized read policy missing: %',t;end if;
 if has_table_privilege('anon','public.'||t,'SELECT') or has_table_privilege('authenticated','public.'||t,'INSERT') or has_table_privilege('authenticated','public.'||t,'UPDATE') or has_table_privilege('authenticated','public.'||t,'DELETE') then raise exception 'Client write/anonymous read available: %',t;end if;
 if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgfoid='public.independent_jev_guard()'::regprocedure and not tgisinternal) then raise exception 'Immutable guard missing: %',t;end if;
 end loop;
 if has_function_privilege('authenticated','public.start_independent_jev_benchmark(uuid,uuid,text,boolean,jsonb)','EXECUTE') or has_function_privilege('anon','public.claim_independent_jev_run(uuid)','EXECUTE') then raise exception 'Service RPC exposed';end if;
 if exists(select 1 from pg_proc where proname in ('start_independent_jev_benchmark','claim_independent_jev_run','claim_independent_jev_tasks','complete_independent_jev_task','finish_independent_jev_tick') and prosecdef) then raise exception 'Unexpected SECURITY DEFINER';end if;
 select config into c from public.analysis_jev_independent_configurations where id='independent-v11-v12-holdout-v1';
 if c->>'production_enabled'<>'false' or c->>'repeat_count'<>'3' or c->>'concurrency'<>'8' or c->'v11'->'thresholds' is distinct from c->'v12'->'thresholds' or (select count(*) from jsonb_object_keys(c->'v11'->'questions'))<>25 or (select count(*) from jsonb_object_keys(c->'v12'->'questions'))<>25 then raise exception 'Configuration invalid';end if;
 s=public.validate_independent_jev_source('d7d7142c-03ef-48c3-b36e-bacf6d923f40');
 if (s->>'reviews')::integer<>32 or (s->>'labels')::integer<>800 or (s->>'uncertain')::integer<>11 then raise exception 'Sealed source invalid';end if;
 if exists(select 1 from public.analysis_jev_independent_runs) or exists(select 1 from public.analysis_jev_independent_tasks) then raise exception 'Real benchmark must not be started during deployment';end if;
end $$;
rollback;
