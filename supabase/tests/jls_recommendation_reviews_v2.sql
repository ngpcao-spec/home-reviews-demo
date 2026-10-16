-- Transactional, network-free tests on the frozen run; always roll back.
do $test$declare v jsonb=current_setting('jls.recommendation_review_fixture')::jsonb;rid uuid;r2 uuid;bad jsonb;raw_run jsonb;attempts bigint;begin
 select to_jsonb(r) into raw_run from public.analysis_jls_restaurant_runs r where id=(v->'body'->>'run_id')::uuid;
 select sum(request_count) into attempts from public.analysis_jls_restaurant_tasks where run_id=(v->'body'->>'run_id')::uuid;
 rid=public.save_jls_recommendation_review((v->'body'->>'run_id')::uuid,v);
 r2=public.save_jls_recommendation_review((v->'body'->>'run_id')::uuid,v);
 if rid<>r2 then raise exception 'TEST_NOT_IDEMPOTENT';end if;
 -- Structured text changes cannot be smuggled in as a revalidation.
 bad=jsonb_set(v,'{body,derivative,raw,report,recommendations,0,proposed_action,text}','"Invented different action"');
 bad=jsonb_set(bad,'{body,derivative,raw_sha256}',to_jsonb(public.jls_restaurant_hash(bad->'body'->'derivative'->'raw')));
 bad=jsonb_set(bad,'{body,derivative,validation,raw_response_sha256}',bad->'body'->'derivative'->'raw_sha256');
 bad=jsonb_set(bad,'{body,derivative,validation_sha256}',to_jsonb(public.jls_restaurant_hash(bad->'body'->'derivative'->'validation')));
 bad=jsonb_set(bad,'{sha256}',to_jsonb(public.jls_restaurant_hash(bad->'body')));
 begin perform public.save_jls_recommendation_review((v->'body'->>'run_id')::uuid,bad);raise exception 'TEST_DERIVATIVE_TEXT_CHANGED';exception when others then if sqlerrm='TEST_DERIVATIVE_TEXT_CHANGED' then raise;end if;end;
 bad=jsonb_set(v,'{body,order_candidates,0,status}','"ACCEPTED"');
 bad=jsonb_set(bad,'{sha256}',to_jsonb(public.jls_restaurant_hash(bad->'body')));
 begin perform public.save_jls_recommendation_review((v->'body'->>'run_id')::uuid,bad);raise exception 'TEST_INHERITED_LUNA_ACCEPTED';exception when others then if sqlerrm='TEST_INHERITED_LUNA_ACCEPTED' then raise;end if;end;
 begin update public.analysis_jls_recommendation_reviews set sha256=repeat('0',64) where id=rid;raise exception 'TEST_MUTABLE_REVIEW';exception when others then if sqlerrm='TEST_MUTABLE_REVIEW' then raise;end if;end;
 if (select to_jsonb(r) from public.analysis_jls_restaurant_runs r where id=(v->'body'->>'run_id')::uuid) is distinct from raw_run or
 (select sum(request_count) from public.analysis_jls_restaurant_tasks where run_id=(v->'body'->>'run_id')::uuid)<>attempts then raise exception 'TEST_SOURCE_MUTATED';end if;
 perform set_config('jls.test_review',rid::text,true);
 perform set_config('jls.test_authority',(select authority_user_id::text from public.analysis_jls_restaurant_protocols where id=(v->'body'->>'source_protocol_id')::uuid),true);
end $test$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('jls.test_authority'),'role','authenticated')::text,true);
do $test$begin
 if not exists(select 1 from public.analysis_jls_recommendation_reviews where id=current_setting('jls.test_review')::uuid) then raise exception 'TEST_OWNER_READ';end if;
 begin perform public.save_jls_recommendation_review(null,null);raise exception 'TEST_BROWSER_WRITE';exception when insufficient_privilege then null;end;
end $test$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $test$begin if exists(select 1 from public.analysis_jls_recommendation_reviews) then raise exception 'TEST_CROSS_TENANT';end if;end $test$;
set local role anon;
do $test$begin begin perform count(*) from public.analysis_jls_recommendation_reviews;raise exception 'TEST_ANON_READ';exception when insufficient_privilege then null;end;end $test$;
reset role;
select 'Review V2 SQL/RLS, idempotence, immutable source/result, no inherited Luna, source preservation: PASS' checks;

