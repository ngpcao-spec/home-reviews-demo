-- Synthetic rollback-only checks. No real Artisan selection, annotations, provider or historical report.
begin;
do $$
declare fixture_id uuid:=gen_random_uuid();org uuid;est uuid;actor uuid;rid uuid;worker uuid:=gen_random_uuid();rev integer:=0;rejected boolean;rubric jsonb;choices jsonb;task public.analysis_negative_validation_tasks;keys text[]:=array['food_quality','freshness','cooking','temperature','portions','presentation','drinks','variety','consistency','friendly_staff','attentiveness','wait_time','coordination','communication','order_accuracy','professionalism','atmosphere','decor','noise','comfort','cleanliness','location','value','billing','price_level'];
begin
 if has_table_privilege('authenticated','public.analysis_negative_validation_reviews','SELECT,INSERT,UPDATE,DELETE') or has_function_privilege('anon','public.write_negative_validation(uuid,uuid,integer,text,jsonb)','EXECUTE') then raise exception 'raw access enabled';end if;
 select e.organization_id,e.id,m.user_id into org,est,actor from public.establishments e join public.organization_members m on m.organization_id=e.organization_id where m.role in ('owner','admin','manager') limit 1;
 if actor is null then raise exception 'fixture actor required';end if;
 rejected=false;begin perform public.create_negative_validation(gen_random_uuid(),org,est,'[]','[]','{}','{}','{}');exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;rejected=true;end;if not rejected then raise exception 'unauthorized create accepted';end if;
 select jsonb_object_agg(k,jsonb_build_object('axis','quality','fr',k,'vi',k,'definition_fr','Synthetic definition','definition_vi','Synthetic definition')),jsonb_object_agg(k,'absent') into rubric,choices from unnest(keys) k;
 insert into public.analysis_negative_validation_runs(id,organization_id,establishment_id,name,methodology,rubric_version,rubric,selection_pool,model_config,created_by)
 values(fixture_id,org,est,'artisan-negative-validation-v1','independent_negative_mixed_validation','human-aligned-review-rubric-v1',rubric,'[]','{}',actor);
 for n in 1..32 loop rid=gen_random_uuid();insert into public.analysis_negative_validation_reviews(experiment_id,review_id,position,overall_rating,original_language,original_text_sha256,analysis_source,normalized_category_ratings,selection_bucket,selection_hash)
  values(fixture_id,rid,n,case when n<=20 then 2 when n<=28 then 4 else 5 end,'ru',repeat('0',64),'english_pending','{"food":5,"service":2,"atmosphere":4}',case when n<=20 then 'low' when n<=28 then 'mixed' else 'control' end,repeat('0',64));end loop;
 select review_id into rid from public.analysis_negative_validation_reviews where experiment_id=fixture_id limit 1;
 rejected=false;begin perform public.write_negative_validation(actor,fixture_id,0,'confirm_review',jsonb_build_object('review_id',rid,'choices',choices));exception when others then if sqlerrm<>'NEGATIVE_ENGLISH_REQUIRED' then raise;end if;rejected=true;end;if not rejected then raise exception 'annotation accepted without English';end if;
 update public.analysis_negative_validation_reviews set analysis_text='SYNTHETIC ENGLISH ONLY',analysis_language='en',analysis_source='google_translation_en',analysis_text_sha256=encode(extensions.digest('SYNTHETIC ENGLISH ONLY','sha256'),'hex') where experiment_id=fixture_id;
 rejected=false;begin update public.analysis_negative_validation_reviews set analysis_text='mutated' where experiment_id=fixture_id;exception when others then if sqlerrm<>'NEGATIVE_TEXT_IMMUTABLE' then raise;end if;rejected=true;end;if not rejected then raise exception 'frozen text mutable';end if;
 for rid in select review_id from public.analysis_negative_validation_reviews where experiment_id=fixture_id loop rev=public.write_negative_validation(actor,fixture_id,rev,'confirm_review',jsonb_build_object('review_id',rid,'choices',choices));end loop;
 if (select count(*) from public.analysis_negative_validation_labels where experiment_id=fixture_id)<>800 then raise exception 'implicit absent failed';end if;
 rejected=false;begin perform public.write_negative_validation(actor,fixture_id,0,'confirm_review',jsonb_build_object('review_id',rid,'choices',choices));exception when others then if sqlerrm<>'NEGATIVE_REVISION_CHANGED' then raise;end if;rejected=true;end;if not rejected then raise exception 'stale revision accepted';end if;
 rev=public.write_negative_validation(actor,fixture_id,rev,'finalize_human',jsonb_build_object('dataset_fingerprint',repeat('a',64),'label_fingerprint',repeat('b',64)));
 if (select benchmark_status from public.analysis_negative_validation_runs where id=fixture_id)<>'idle' or exists(select 1 from public.analysis_negative_validation_tasks where experiment_id=fixture_id) then raise exception 'benchmark started automatically';end if;
 rejected=false;begin update public.analysis_negative_validation_labels set choice='positive' where experiment_id=fixture_id;exception when others then if sqlerrm<>'NEGATIVE_HUMAN_IMMUTABLE' then raise;end if;rejected=true;end;if not rejected then raise exception 'human labels mutable';end if;
 rev=public.write_negative_validation(actor,fixture_id,rev,'start_benchmark','{}');perform public.write_negative_validation(actor,fixture_id,0,'start_benchmark','{}');
 if (select count(*) from public.analysis_negative_validation_tasks where experiment_id=fixture_id)<>192 then raise exception 'duplicated or missing tasks';end if;
 update public.analysis_negative_validation_runs set benchmark_status='running',locked_by=worker,lease_until=now()+interval '240 seconds' where id=fixture_id;
 if (select count(*) from public.claim_negative_validation_tasks(fixture_id,worker))<>8 then raise exception 'concurrency cap failed';end if;
 for task in select * from public.analysis_negative_validation_tasks where experiment_id=fixture_id and status='running' loop
  if not public.complete_negative_validation_task(fixture_id,worker,task.id,'{"status":"completed","response":{"synthetic":true},"served_model":"fixture","input_tokens":10,"output_tokens":1,"request_count":1,"retry_count":0,"duration_ms":1,"error_code":null,"usage_complete":true}') then raise exception 'task save failed';end if;
  if public.complete_negative_validation_task(fixture_id,worker,task.id,'{}') then raise exception 'paid task replay accepted';end if;
 end loop;
 -- Simulate interrupted paid requests: new worker marks them unavailable, never pending again.
 perform public.claim_negative_validation_tasks(fixture_id,worker);
 update public.analysis_negative_validation_runs set locked_by=gen_random_uuid() where id=fixture_id returning locked_by into worker;
 perform public.claim_negative_validation_tasks(fixture_id,worker);
 if (select count(*) from public.analysis_negative_validation_tasks where experiment_id=fixture_id and error_code='JEV_INTERRUPTED_UNCONFIRMED')<>8 then raise exception 'ambiguous response replayed';end if;
 update public.analysis_negative_validation_tasks set status='failed',error_code='SYNTHETIC_UNUSED' where experiment_id=fixture_id and status in ('pending','running');
 if not public.finish_negative_validation_tick(fixture_id,worker,'{"synthetic":true}',null) then raise exception 'result completion failed';end if;
 rejected=false;begin update public.analysis_negative_validation_results set comparison='{}' where experiment_id=fixture_id;exception when others then if sqlerrm<>'NEGATIVE_RESULTS_IMMUTABLE' then raise;end if;rejected=true;end;if not rejected then raise exception 'results mutable';end if;
end $$;
rollback;
select 'negative validation synthetic English/labels/lease/immutability checks passed; all fixtures rolled back' result;
