-- Transactional technical mocks only. All fixture rows roll back; no HTTP/wake.
begin;
set local role service_role;
do $$declare c uuid;c2 uuid;op jsonb;b jsonb;res jsonb;raw text='{"explicit_technical_mock":true}';old_run text;begin
 select public.jls_restaurant_hash(to_jsonb(r)) into old_run from public.analysis_jls_restaurant_runs r where id='1a7b3920-e624-40d0-a829-b276f739dbdc';
 c=public.create_jls_direct4_continuation('033a07eb-a054-4437-8cb8-3d6174813f39','4b5ad9a9-1aed-43cd-9429-cf89960cb4d4',repeat('0',40),'mock','sql_transaction');
 c2=public.create_jls_direct4_continuation('033a07eb-a054-4437-8cb8-3d6174813f39','4b5ad9a9-1aed-43cd-9429-cf89960cb4d4',repeat('0',40),'mock','sql_transaction');
 if c<>c2 or not public.check_jls_direct4_continuation(c,true) then raise exception 'IDEMPOTENCE_OR_BINDING';end if;
 perform set_config('direct4_test.id',c::text,true);
 perform set_config('direct4_test.user',(select authority_user_id::text from public.analysis_jls_restaurant_protocols where id='16340d77-7743-4b6b-95a2-c897cb74ba1b'),true);
 op=public.claim_jls_direct4_continuation(c,'first');
 if op->>'request_count'<>'1' or public.claim_jls_direct4_continuation(c,'second') is not null then raise exception 'SECOND_RESERVATION';end if;
 select jsonb_build_object('version','jls-sol-raw-receipt-v1','mock',true,'request_sha256',body->>'request_sha256',
 'request_raw_sha256',body->>'request_raw_sha256','raw_response_text',raw,'raw_response_sha256',encode(extensions.digest(raw,'sha256'),'hex')) into b
 from public.analysis_jls_sol_ready_artifacts where id='059a42bc-f92b-4e8f-8076-0afb706ec3fb';
 if public.receive_jls_direct4_continuation(c,'second',b,public.jls_restaurant_hash(b)) then raise exception 'WRONG_WORKER';end if;
 if not public.receive_jls_direct4_continuation(c,'first',b,public.jls_restaurant_hash(b))
 or not public.receive_jls_direct4_continuation(c,'first',b,public.jls_restaurant_hash(b)) then raise exception 'RECEIPT_IDEMPOTENCE';end if;
 if public.receive_jls_direct4_continuation(c,'first',b,repeat('0',64)) then raise exception 'CHANGED_RECEIPT_ACCEPTED';end if;
 op=public.claim_jls_direct4_continuation(c,'validator');
 if op->>'phase'<>'validate_sol' or op->>'request_count'<>'1' then raise exception 'VALIDATION_REDISPATCH';end if;
 res=jsonb_build_object('explicit_technical_mock',true,'receipt_sha256',public.jls_restaurant_hash(b),'raw_response_sha256',b->>'raw_response_sha256');
 if not public.finish_jls_direct4_continuation(c,'validator','completed',res,public.jls_restaurant_hash(res))
 or not public.finish_jls_direct4_continuation(c,'validator','completed',res,public.jls_restaurant_hash(res))
 or public.claim_jls_direct4_continuation(c,'again') is not null then raise exception 'FINALIZATION_IDEMPOTENCE';end if;
 if not exists(select 1 from public.analysis_jls_snapshot_preparations where kind='direct4_sol_continuation_'||c) then raise exception 'ARCHIVE_NOT_SAVED';end if;
 begin update public.analysis_jls_direct4_continuations set status='queued' where id=c;raise exception 'TERMINAL_REOPENED';
 exception when others then if sqlerrm<>'JLS_READY_IMMUTABLE' then raise;end if;end;
 begin update public.analysis_jls_restaurant_runs set status='queued' where id='1a7b3920-e624-40d0-a829-b276f739dbdc';raise exception 'SOURCE_REOPENED';
 exception when others then if sqlerrm<>'JLS_RUN_IMMUTABLE' then raise;end if;end;
 -- Changed provenance cannot borrow the real consent or frozen request.
 insert into public.analysis_jls_direct4_continuations(organization_id,source_operation_id,source_archive_id,run_id,protocol_id,artifact_id,protocol_sha256,provenance,provenance_sha256,mode,nonce)
 select organization_id,source_operation_id,source_archive_id,run_id,protocol_id,artifact_id,protocol_sha256,
 jsonb_set(provenance,'{consent_sha256}',to_jsonb(repeat('0',64))),public.jls_restaurant_hash(jsonb_set(provenance,'{consent_sha256}',to_jsonb(repeat('0',64)))),'mock','sql_changed_consent'
 from public.analysis_jls_direct4_continuations where id=c returning id into c2;
 if public.check_jls_direct4_continuation(c2,true) then raise exception 'CHANGED_CONSENT_ACCEPTED';end if;
 begin perform public.claim_jls_direct4_continuation(c2,'bad');raise exception 'INVALID_CONSENT_RESERVED';
 exception when others then if sqlerrm<>'DIRECT4_CONTINUATION_SOURCE_OR_CONSENT_INVALID' then raise;end if;end;
 c2=public.create_jls_direct4_continuation('033a07eb-a054-4437-8cb8-3d6174813f39','4b5ad9a9-1aed-43cd-9429-cf89960cb4d4',repeat('0',40),'mock','sql_lost_response');
 perform public.claim_jls_direct4_continuation(c2,'lost');perform public.abort_jls_direct4_continuation(c2,'lost','SIMULATED_TIMEOUT');
 if public.claim_jls_direct4_continuation(c2,'retry') is not null or not exists(select 1 from public.analysis_jls_direct4_continuations where id=c2 and status='billing_uncertain' and request_count=1) then raise exception 'LOST_ATTEMPT_RETRIED';end if;
 if old_run<>(select public.jls_restaurant_hash(to_jsonb(r)) from public.analysis_jls_restaurant_runs r where id='1a7b3920-e624-40d0-a829-b276f739dbdc') then raise exception 'HISTORY_CHANGED';end if;
 if exists(select 1 from public.analysis_jls_direct4_continuations where mode='paid') then raise exception 'PAID_ROW_CREATED_DURING_TEST';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('direct4_test.user'),true);
do $$begin if not exists(select 1 from public.analysis_jls_direct4_continuations where id=current_setting('direct4_test.id')::uuid) then raise exception 'OWNER_CANNOT_READ';end if;end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
do $$begin if exists(select 1 from public.analysis_jls_direct4_continuations) then raise exception 'CROSS_ORG_READ';end if;
 if has_function_privilege('authenticated','public.create_jls_direct4_continuation(uuid,uuid,text,text,text)','execute')
 or has_function_privilege('anon','public.claim_jls_direct4_continuation(uuid,text)','execute') then raise exception 'RPC_EXPOSED';end if;
end $$;
rollback;
