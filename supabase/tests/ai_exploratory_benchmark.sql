-- Synthetic rows in the existing exploration tables only. No real dataset is selected.
begin;
do $$
declare actor uuid;org uuid;est uuid;fixture_id uuid='00000000-0000-4000-8000-000000009922';source_id uuid;worker uuid=gen_random_uuid();answer uuid;
begin
 select id,organization_id,establishment_id,created_by into source_id,org,est,actor from public.analysis_negative_validation_runs where id='a80c5a80-c322-4c13-85d4-e7506f91ec93';
 begin perform public.start_negative_ai_benchmark(actor,source_id,false,'[]','[]',repeat('0',64),repeat('0',64),'{}',.042);raise exception 'Missing paid confirmation accepted';exception when others then if sqlerrm<>'AI_BENCHMARK_PAYMENT_CONFIRMATION_REQUIRED' then raise;end if;end;
 insert into public.analysis_negative_ai_exploratory_runs(id,source_experiment_id,organization_id,establishment_id,created_by,status,launch_approved_at,dataset_snapshot,reference_snapshot,model_config,dataset_sha256,reference_sha256) values(fixture_id,source_id,org,est,actor,'queued',now(),'[{"review_id":"00000000-0000-4000-8000-000000000999","analysis_text":"Synthetic English only"}]','[]','{}',repeat('0',64),repeat('0',64));
 answer=public.start_negative_ai_benchmark(actor,source_id,true,'[]','[]',repeat('0',64),repeat('0',64),'{}',.042);
 if answer<>fixture_id or (select count(*) from public.analysis_negative_ai_exploratory_runs where source_experiment_id=source_id)<>1 then raise exception 'Duplicate run';end if;
 perform public.claim_negative_ai_exploratory_run(worker);
 if (select count(*) from public.claim_negative_ai_tasks(fixture_id,worker))<>0 then raise exception 'Unexpected real tasks';end if;
 begin perform public.finish_negative_ai_benchmark(fixture_id,worker,'{"reference_type":"chatgpt_ai_preannotations","human_validated":false}');raise exception 'Incomplete run published';exception when others then if sqlerrm<>'AI_BENCHMARK_RESULT_INVALID' then raise;end if;end;
 begin update public.analysis_negative_ai_exploratory_runs set dataset_snapshot='[]' where id=fixture_id;raise exception 'Dataset changed';exception when others then if sqlerrm<>'AI_BENCHMARK_IMMUTABLE' then raise;end if;end;
 update public.analysis_negative_ai_exploratory_runs set status='completed' where id=fixture_id;
 begin update public.analysis_negative_ai_exploratory_runs set status='queued' where id=fixture_id;raise exception 'Completed run restarted';exception when others then if sqlerrm<>'AI_BENCHMARK_IMMUTABLE' then raise;end if;end;
 perform set_config('test.ai_actor',actor::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.ai_actor'),'role','authenticated')::text,true);
do $$ begin
 if not exists(select 1 from public.analysis_negative_ai_exploratory_runs where id='00000000-0000-4000-8000-000000009922') then raise exception 'Authorized read denied';end if;
 begin update public.analysis_negative_ai_exploratory_runs set status='queued';raise exception 'Client can launch paid job directly';exception when insufficient_privilege then null;end;
 begin perform public.claim_negative_ai_exploratory_run(gen_random_uuid());raise exception 'Client can call worker';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ begin if exists(select 1 from public.analysis_negative_ai_exploratory_runs where id='00000000-0000-4000-8000-000000009922') then raise exception 'Cross tenant leak';end if;end $$;
reset role;
set local role anon;
do $$ begin begin perform count(*) from public.analysis_negative_ai_exploratory_runs;raise exception 'Anonymous read allowed';exception when insufficient_privilege then null;end;end $$;
reset role;
rollback;
