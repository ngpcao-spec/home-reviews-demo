-- Synthetic new-table fixtures only; no real source dataset, model, or historical write.
begin;
do $$
declare actor uuid;org uuid;est uuid;run_key uuid='00000000-0000-4000-8000-000000009911';review_key uuid;worker_key uuid=gen_random_uuid();approval uuid;import_key uuid=gen_random_uuid();row_data jsonb;items jsonb;prediction jsonb='{"choice":"positive","positive":1,"negative":0,"stable":true}';n integer;
begin
 select m.user_id,m.organization_id,e.id into actor,org,est from public.organization_members m join public.establishments e on e.organization_id=m.organization_id where m.role in ('owner','admin','manager') order by e.id limit 1;
 if actor is null then raise exception 'Fixture requires existing organization membership';end if;
 insert into public.analysis_jev_exploratory_runs(id,organization_id,establishment_id,source_kind,source_id,dataset_sha256,config,rate,created_by) values(run_key,org,est,'negative_validation',gen_random_uuid(),repeat('0',64),'{"thresholds":{"food_quality":{},"freshness":{}},"repeat_count":3}',.042,actor);
 for n in 1..32 loop
  review_key=('00000000-0000-4000-8000-'||lpad((991100+n)::text,12,'0'))::uuid;
  insert into public.analysis_jev_exploratory_items(run_id,review_id,position,analysis_text,analysis_text_sha256,overall_rating,normalized_category_ratings) values(run_key,review_key,n,'Synthetic English review only.',encode(extensions.digest('Synthetic English review only.','sha256'),'hex'),2,'{"food":null,"service":null,"atmosphere":null}');
 end loop;
 begin perform public.write_jev_exploration(actor,run_key,'start','{}');raise exception 'Missing paid confirmation accepted';exception when others then if sqlerrm<>'EXPLORATORY_PAYMENT_CONFIRMATION_REQUIRED' then raise;end if;end;
 perform public.write_jev_exploration(actor,run_key,'start','{"confirm":true}');perform public.write_jev_exploration(actor,run_key,'start','{"confirm":true}');
 if (select count(*) from public.analysis_jev_exploratory_tasks where run_id=run_key)<>96 then raise exception 'Double launch or human guard';end if;
 perform public.claim_jev_explorations(worker_key);perform public.claim_jev_exploratory_tasks(run_key,worker_key);
 if (select count(*) from public.analysis_jev_exploratory_tasks where run_id=run_key and status='running')<>8 then raise exception 'Concurrency invalid';end if;
 -- A lost lease never replays potentially billed responses.
 update public.analysis_jev_exploratory_runs set lease_until=now()-interval '1 second' where id=run_key;
 worker_key=gen_random_uuid();perform public.claim_jev_explorations(worker_key);
 if (select count(*) from public.analysis_jev_exploratory_tasks where run_id=run_key and status='failed' and error_code='JEV_RESPONSE_UNCONFIRMED')<>8 then raise exception 'Ambiguous tasks replayed';end if;
 update public.analysis_jev_exploratory_tasks set status='completed' where run_id=run_key and status='pending';
 select jsonb_agg(jsonb_build_object('review_id',review_id,'v11',jsonb_build_object('food_quality',prediction))) into items from public.analysis_jev_exploratory_items where run_id=run_key;
 perform public.finish_jev_exploratory_tick(run_key,worker_key,items);
 begin update public.analysis_jev_exploratory_items set analysis_text='Changed' where run_id=run_key;raise exception 'Completed dataset modified';exception when others then if sqlerrm<>'EXPLORATORY_IMMUTABLE' then raise;end if;end;
 select review_id into review_key from public.analysis_jev_exploratory_items where run_id=run_key and position=1;
 approval=(public.write_jev_exploration(actor,run_key,'approve',jsonb_build_object('confirm',true,'review_ids',jsonb_build_array(review_key),'bundle_sha256',repeat('1',64)))->>'approval_id')::uuid;
 row_data=jsonb_build_object('review_id',review_key,'theme_key','food_quality','initial_prediction',prediction,'choice','absent','justification','Synthetic AI justification','corrector_model','fixture-model-v1','corrected_at',now(),'analysis_text_sha256',encode(extensions.digest('Synthetic English review only.','sha256'),'hex'),'label_source','chatgpt_ai_correction');
 perform public.write_jev_exploration(actor,run_key,'import',jsonb_build_object('approval_id',approval,'bundle_sha256',repeat('1',64),'import_id',import_key,'corrections',jsonb_build_array(row_data)));
 perform public.write_jev_exploration(actor,run_key,'import',jsonb_build_object('approval_id',approval,'bundle_sha256',repeat('1',64),'import_id',import_key,'corrections',jsonb_build_array(row_data)));
 if (select count(*) from public.analysis_jev_exploratory_corrections where run_id=run_key)<>1 then raise exception 'Correction import not idempotent';end if;
 begin update public.analysis_jev_exploratory_corrections set choice='positive' where run_id=run_key;raise exception 'Correction rewritten';exception when others then if sqlerrm<>'EXPLORATORY_IMMUTABLE' then raise;end if;end;
 begin perform public.write_jev_exploration(actor,run_key,'reserve',jsonb_build_object('future_version',12,'purpose','evaluation','review_ids',jsonb_build_array(review_key)));raise exception 'AI corrected review allowed in independent evaluation';exception when others then if sqlerrm<>'EXPLORATORY_EVALUATION_CONTAMINATION' then raise;end if;end;
 approval=(public.write_jev_exploration(actor,run_key,'approve',jsonb_build_object('confirm',true,'review_ids',jsonb_build_array(review_key),'bundle_sha256',repeat('3',64)))->>'approval_id')::uuid;
 row_data=row_data||jsonb_build_object('theme_key','freshness','initial_prediction',null);
 perform public.write_jev_exploration(actor,run_key,'import',jsonb_build_object('approval_id',approval,'bundle_sha256',repeat('3',64),'import_id',gen_random_uuid(),'corrections',jsonb_build_array(row_data)));
 if not exists(select 1 from public.analysis_jev_exploratory_corrections where run_id=run_key and theme_key='freshness' and initial_prediction='null'::jsonb) then raise exception 'Unavailable prediction was invented';end if;
 perform public.write_jev_exploration(actor,run_key,'reserve',jsonb_build_object('future_version',12,'purpose','calibration','review_ids',jsonb_build_array(review_key)));
 select review_id into review_key from public.analysis_jev_exploratory_items where run_id=run_key and position=2;
 perform public.write_jev_exploration(actor,run_key,'reserve',jsonb_build_object('future_version',12,'purpose','evaluation','review_ids',jsonb_build_array(review_key)));
 begin perform public.write_jev_exploration(actor,run_key,'reserve',jsonb_build_object('future_version',12,'purpose','calibration','review_ids',jsonb_build_array(review_key)));raise exception 'Same review used for calibration/evaluation';exception when others then if sqlerrm<>'EXPLORATORY_EVALUATION_CONTAMINATION' then raise;end if;end;
 begin perform public.write_jev_exploration(actor,run_key,'approve',jsonb_build_object('confirm',true,'review_ids',jsonb_build_array(review_key),'bundle_sha256',repeat('2',64)));raise exception 'Independent evaluation exposed to AI';exception when others then if sqlerrm<>'EXPLORATORY_EVALUATION_CONTAMINATION' then raise;end if;end;
 perform set_config('test.exploratory_actor',actor::text,true);
 raise notice 'Synthetic SQL: manual start, double launch, concurrency, ambiguous response, immutable data, explicit GO, import and separation passed';
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.exploratory_actor'),'role','authenticated')::text,true);
do $$ begin
 if not exists(select 1 from public.analysis_jev_exploratory_runs where id='00000000-0000-4000-8000-000000009911') then raise exception 'Authorized member cannot read';end if;
 begin update public.analysis_jev_exploratory_runs set status='idle';raise exception 'Client has write grant';exception when insufficient_privilege then null;end;
 begin perform public.write_jev_exploration(current_setting('test.exploratory_actor')::uuid,'00000000-0000-4000-8000-000000009911','start','{"confirm":true}');raise exception 'Client can call worker RPC';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ begin if exists(select 1 from public.analysis_jev_exploratory_runs where id='00000000-0000-4000-8000-000000009911') or exists(select 1 from public.analysis_jev_exploratory_items where run_id='00000000-0000-4000-8000-000000009911') or exists(select 1 from public.analysis_jev_exploratory_corrections where run_id='00000000-0000-4000-8000-000000009911') then raise exception 'Cross tenant leak';end if;end $$;
reset role;
set local role anon;
do $$ begin begin perform count(*) from public.analysis_jev_exploratory_runs;raise exception 'Anonymous read allowed';exception when insufficient_privilege then null;end;end $$;
reset role;
rollback;
