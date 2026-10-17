-- BEGIN / ROLLBACK. Input is a real, offline recomputed saved receipt result.
-- This test creates only a free revalidation row inside the rollback transaction.
do $$declare c jsonb=current_setting('jls.saved_replay')::jsonb;rid uuid;again uuid;b jsonb;begin
 rid=public.save_jls_saved_response_validation_v2((c->'body'->>'source_operation_id')::uuid,c->'body',c->>'sha256');
 again=public.save_jls_saved_response_validation_v2((c->'body'->>'source_operation_id')::uuid,c->'body',c->>'sha256');
 if rid<>again then raise exception 'TEST_DUPLICATE_REVALIDATION';end if;
 b=c->'body'||'{"provider_calls":1}';
 begin perform public.save_jls_saved_response_validation_v2((b->>'source_operation_id')::uuid,b,public.jls_restaurant_hash(b));raise exception 'TEST_PROVIDER_CALL_ALLOWED';
 exception when others then if sqlerrm='TEST_PROVIDER_CALL_ALLOWED' then raise;end if;end;
 b=c->'body'||'{"source_receipt_sha256":"changed"}';
 begin perform public.save_jls_saved_response_validation_v2((b->>'source_operation_id')::uuid,b,public.jls_restaurant_hash(b));raise exception 'TEST_RECEIPT_CHANGED';
 exception when others then if sqlerrm='TEST_RECEIPT_CHANGED' then raise;end if;end;
 b=c->'body'||'{"source_run_id":"00000000-0000-4000-8000-000000000001"}';
 begin perform public.save_jls_saved_response_validation_v2((b->>'source_operation_id')::uuid,b,public.jls_restaurant_hash(b));raise exception 'TEST_RUN_CHANGED';
 exception when others then if sqlerrm='TEST_RUN_CHANGED' then raise;end if;end;
 b=jsonb_set(c->'body','{result,raw_response_text}','"FORGED"');b=jsonb_set(b,'{result_sha256}',to_jsonb(public.jls_restaurant_hash(b->'result')));
 begin perform public.save_jls_saved_response_validation_v2((b->>'source_operation_id')::uuid,b,public.jls_restaurant_hash(b));raise exception 'TEST_RAW_FORGED';
 exception when others then if sqlerrm='TEST_RAW_FORGED' then raise;end if;end;
 begin update public.analysis_jls_snapshot_preparations set body='{}' where id=rid;raise exception 'TEST_RESULT_MUTATED';
 exception when others then if sqlerrm='TEST_RESULT_MUTATED' then raise;end if;end;
 perform set_config('jls.saved_replay_id',rid::text,true);
 perform set_config('jls.saved_replay_user',(select authority_user_id::text from public.analysis_jls_restaurant_protocols where id=(select protocol_id from public.analysis_jls_snapshot_preparations where id=rid)),true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('jls.saved_replay_user'),'role','authenticated')::text,true);
do $$begin
 if not exists(select 1 from public.analysis_jls_snapshot_preparations where id=current_setting('jls.saved_replay_id')::uuid) then raise exception 'TEST_OWNER_READ';end if;
 begin perform public.save_jls_saved_response_validation_v2(null,null,null);raise exception 'TEST_BROWSER_WRITE';exception when insufficient_privilege then null;end;
 begin update public.analysis_jls_snapshot_preparations set kind='FORGED' where id=current_setting('jls.saved_replay_id')::uuid;raise exception 'TEST_BROWSER_UPDATE';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$begin if exists(select 1 from public.analysis_jls_snapshot_preparations where id=current_setting('jls.saved_replay_id')::uuid) then raise exception 'TEST_CROSS_TENANT';end if;end $$;
set local role anon;
do $$begin begin perform count(*) from public.analysis_jls_snapshot_preparations;raise exception 'TEST_ANON_READ';exception when insufficient_privilege then null;end;end $$;
reset role;
select 'free SQL save / idempotence / changed source rejection / immutable row / owner read / browser write denial / outsider / anon: PASS' checks;
