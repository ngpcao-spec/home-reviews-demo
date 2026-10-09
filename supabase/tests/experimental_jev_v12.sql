-- Synthetic new-table rows only, rolled back. Never selects real review text or launches a paid task.
begin;
do $$
declare actor uuid;org uuid;est uuid;source_id uuid='adfa4fdf-a8c7-4976-916f-339ebabb8d62';fixture_id uuid='00000000-0000-4000-8000-000000121212';worker uuid=gen_random_uuid();cfg jsonb;cfg_hash text;review_id uuid;prepared jsonb;count_before integer;answer uuid;
begin
 select created_by,organization_id,establishment_id into actor,org,est from public.analysis_negative_ai_exploratory_runs where id=source_id;
 select config,config_sha256 into cfg,cfg_hash from public.analysis_jev_experimental_configurations where id='themes_v12_semantic_boundaries_v1';
 if cfg->>'production_enabled'<>'false' or (select count(*) from jsonb_object_keys(cfg->'questions'))<>25 or cfg->>'concurrency'<>'8' or cfg->>'repeat_count'<>'3' then raise exception 'V12 config invalid';end if;
 begin update public.analysis_jev_experimental_configurations set config_sha256=repeat('0',64);raise exception 'Frozen config editable';exception when others then if sqlerrm<>'V12_IMMUTABLE' then raise;end if;end;
 begin perform public.start_experimental_jev_v12(actor,source_id,'themes_v12_semantic_boundaries_v1',false,'{}');raise exception 'Paid confirmation bypassed';exception when others then if sqlerrm<>'V12_PAYMENT_CONFIRMATION_REQUIRED' then raise;end if;end;
 prepared=jsonb_build_object('config_sha256',cfg_hash,'expected_requests',9,'input_rate',.042,'items','[]'::jsonb,'reference','[]'::jsonb,'baseline','[]'::jsonb);
 insert into public.analysis_jev_v12_runs(id,organization_id,establishment_id,source_benchmark_id,configuration_id,config,prepared,created_by) values(fixture_id,org,est,source_id,'themes_v12_semantic_boundaries_v1',cfg,prepared,actor);
 for review_id in select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(121220,121222) n loop
 insert into public.analysis_jev_v12_tasks(run_id,review_id,analysis_text_sha256,review_alias,question_set,repeat) select fixture_id,review_id,repeat('0',64),'fixture','themes_v12_semantic_boundaries_v1',n from generate_series(1,3) n;
 end loop;
 answer=public.start_experimental_jev_v12(actor,source_id,'themes_v12_semantic_boundaries_v1',true,prepared);
 if answer<>fixture_id or (select count(*) from public.analysis_jev_v12_tasks where run_id=fixture_id)<>9 then raise exception 'Double launch';end if;
 perform public.claim_experimental_v12_run(worker);perform public.claim_experimental_v12_tasks(fixture_id,worker);
 if (select count(*) from public.analysis_jev_v12_tasks where run_id=fixture_id and status='running')<>8 then raise exception 'Concurrency not eight';end if;
 update public.analysis_jev_v12_runs set lease_until=now()-interval '1 second' where id=fixture_id;
 worker=gen_random_uuid();perform public.claim_experimental_v12_run(worker);
 if (select count(*) from public.analysis_jev_v12_tasks where run_id=fixture_id and error_code='JEV_RESPONSE_UNCONFIRMED' and status='failed')<>8 then raise exception 'Potentially paid task retried';end if;
 begin update public.analysis_jev_v12_runs set prepared='{}' where id=fixture_id;raise exception 'Prepared snapshots modified';exception when others then if sqlerrm<>'V12_IMMUTABLE' then raise;end if;end;
 update public.analysis_jev_v12_tasks set status='completed' where run_id=fixture_id and status='pending';
 perform public.finish_experimental_v12_tick(fixture_id,worker,'{"human_validated":false,"production_enabled":false}'::jsonb);
 begin update public.analysis_jev_v12_runs set status='queued' where id=fixture_id;raise exception 'Completed run restarted';exception when others then if sqlerrm<>'V12_IMMUTABLE' then raise;end if;end;
 begin update public.analysis_jev_v12_results set comparison='{}' where run_id=fixture_id;raise exception 'Result overwritten';exception when others then if sqlerrm<>'V12_IMMUTABLE' then raise;end if;end;
 perform set_config('test.v12_actor',actor::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.v12_actor'),'role','authenticated')::text,true);
do $$ begin
 if not exists(select 1 from public.analysis_jev_v12_runs where id='00000000-0000-4000-8000-000000121212') then raise exception 'Manager read denied';end if;
 begin update public.analysis_jev_v12_runs set status='queued';raise exception 'Client can launch directly';exception when insufficient_privilege then null;end;
 begin perform public.claim_experimental_v12_run(gen_random_uuid());raise exception 'Client can call worker';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ begin if exists(select 1 from public.analysis_jev_v12_runs where id='00000000-0000-4000-8000-000000121212') or exists(select 1 from public.analysis_jev_v12_tasks where run_id='00000000-0000-4000-8000-000000121212') then raise exception 'Cross tenant leak';end if;end $$;
reset role;
set local role anon;
do $$ begin begin perform count(*) from public.analysis_jev_v12_runs;raise exception 'Anonymous data exposed';exception when insufficient_privilege then null;end;end $$;
reset role;
rollback;
