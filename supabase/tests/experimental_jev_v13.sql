-- Read-only deployment checks. No run/task, annotation, future holdout or provider request is created.
begin transaction read only;
do $$
declare t text;c jsonb;first_source jsonb;second_source jsonb;
begin
 foreach t in array array['analysis_jev_v13_configurations','analysis_jev_v13_sealed_inputs','analysis_jev_v13_runs','analysis_jev_v13_tasks','analysis_jev_v13_results'] loop
 if not(select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'V13 RLS missing: %',t;end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and roles=array['authenticated']::name[] and cmd='SELECT' and qual like '%organization_members%') then raise exception 'V13 organization policy missing: %',t;end if;
 if has_table_privilege('anon','public.'||t,'SELECT') or has_table_privilege('authenticated','public.'||t,'INSERT') or has_table_privilege('authenticated','public.'||t,'UPDATE') or has_table_privilege('authenticated','public.'||t,'DELETE') then raise exception 'V13 unsafe client privileges: %',t;end if;
 if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgfoid='public.experimental_v13_guard()'::regprocedure and not tgisinternal) then raise exception 'V13 immutable guard missing: %',t;end if;
 end loop;
 if has_function_privilege('authenticated','public.start_experimental_jev_v13(uuid,uuid,text,text,boolean,jsonb)','EXECUTE') or has_function_privilege('anon','public.claim_experimental_v13_run(uuid)','EXECUTE') then raise exception 'V13 server RPC exposed';end if;
 if exists(select 1 from pg_proc where proname in ('read_jev_v13_source','start_experimental_jev_v13','claim_experimental_v13_run','claim_experimental_v13_tasks','complete_experimental_v13_task','finish_experimental_v13_tick') and prosecdef) then raise exception 'Unexpected V13 SECURITY DEFINER';end if;
 select config into c from public.analysis_jev_v13_configurations where id='themes_v13_targeted_recall_v1';
 if c->>'production_enabled'<>'false' or c->>'repeat_count'<>'3' or c->>'concurrency'<>'8' or c->'v12'->'thresholds' is distinct from c->'v13'->'thresholds' or c->'v12' is distinct from(select config from public.analysis_jev_experimental_configurations where id='themes_v12_semantic_boundaries_v1') or (select count(*) from jsonb_object_keys(c->'v13'->'questions'))<>25 then raise exception 'V13 configuration invalid';end if;
 first_source=public.read_jev_v13_source('development_first','1b06d0d9-623b-4ee4-b267-d1078a2aaa74');
 second_source=public.read_jev_v13_source('development_second','696e6e36-a024-4f69-957e-9cd4e0b50d1b');
 if jsonb_array_length(first_source->'run'->'prepared'->'items')<>30 or jsonb_array_length(first_source->'tasks')<>90 or jsonb_array_length(second_source->'paired_ids')<>31 or jsonb_array_length(second_source->'audits')<>19 then raise exception 'V13 source cohort/audits invalid';end if;
 if exists(select 1 from public.analysis_jev_v13_runs) or exists(select 1 from public.analysis_jev_v13_tasks) or exists(select 1 from public.analysis_jev_v13_sealed_inputs) then raise exception 'V13 must not be launched or a future holdout created during deployment';end if;
end $$;
rollback;
