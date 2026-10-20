begin;set local role service_role;set local jit=off;
do $$declare p public.analysis_jls_restaurant_protocols;rid uuid=gen_random_uuid();qid uuid=gen_random_uuid();c jsonb;v jsonb;t jsonb;body jsonb;wire text;timings jsonb='[]';at timestamptz;begin
select * into p from public.analysis_jls_restaurant_protocols where id='f7eb5b73-ba21-46ac-bd84-be6e0aa4231e';
if not public.check_jls_source_certificate(p.id) then raise exception 'SOURCE_CERTIFICATE';end if;
begin perform public.authorize_luna_direct4_comparison(p.id,'{}',public.jls_restaurant_hash('{}'));raise exception 'NO_GO_ACCEPTED';
exception when others then if sqlerrm<>'LUNA_DIRECT4_DELEGATION_REQUIRED' then raise;end if;end;
if public.check_luna_direct4_comparison_sources(jsonb_set(p.body,'{items,0,analysis_text}','"WRONG TEXT"')) then raise exception 'WRONG_TEXT_ACCEPTED';end if;
insert into public.analysis_jls_sql_qualifications(id,protocol_id,organization_id,protocol_sha256,run_id,nonce,expires_at)
values(qid,p.id,p.organization_id,p.sha256,rid,'luna_native_87_rollback',now()+interval '2 hours');
c=jsonb_build_object('consent_source','technical_qualification_no_spending','qualification_id',qid,'protocol_sha256',p.sha256,'provider_calls',0);
insert into public.analysis_jls_restaurant_runs(id,protocol_id,organization_id,stage,consent,consent_sha256,expires_at)
values(rid,p.id,p.organization_id,'luna',c,public.jls_restaurant_hash(c),now()+interval '2 hours');
for v in select value from jsonb_array_elements(p.body->'items') loop
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256)
 values(rid,p.organization_id,'luna',v->>'review_id',(v->>'review_id')::uuid,
 jsonb_build_object('model','gpt-6-luna','input',v->>'input_json','questions',p.body#>'{configuration,questions}'),v->>'request_sha256');
end loop;
if public.claim_jls_restaurant_task(rid,null) is not null then raise exception 'NULL_LEASE';end if;
if not public.claim_jls_restaurant_tick(rid,'MOCK') or public.claim_jls_restaurant_tick(rid,'OTHER') then raise exception 'LEASE_NOT_EXCLUSIVE';end if;
for i in 1..87 loop
 at=clock_timestamp();t=public.claim_jls_restaurant_task(rid,'MOCK');timings=timings||jsonb_build_array(extract(epoch from clock_timestamp()-at)*1000);
 if t is null or t->>'request_count'<>'1' or jsonb_array_length(t#>'{request,questions}')<>4 then raise exception 'CLAIM_FAILED';end if;
 if not public.begin_jls_restaurant_dispatch((t->>'id')::uuid,'MOCK',t->>'request_sha256') or public.begin_jls_restaurant_dispatch((t->>'id')::uuid,'MOCK',t->>'request_sha256') then raise exception 'DUPLICATE_DISPATCH';end if;
 body=jsonb_build_object('phase','luna','request_sha256',t->>'request_sha256','explicit_technical_mock',true,'raw_response_text','{"EXPLICIT_MOCK":true}',
 'raw_response_sha256',encode(extensions.digest('{"EXPLICIT_MOCK":true}','sha256'),'hex'));
 v=jsonb_build_object('version','jls-restaurant-receipt-v1','source_kind','provider_outcome','task_id',t->>'id','worker','MOCK','protocol_sha256',p.sha256,'status','completed','body',body,'sha256',public.jls_restaurant_hash(body));wire=v::text;
 if not public.save_jls_restaurant_receipt((t->>'id')::uuid,'MOCK',wire,encode(extensions.digest(wire,'sha256'),'hex'))
 or not public.finish_jls_restaurant_receipt((t->>'id')::uuid) or not public.finish_jls_restaurant_receipt((t->>'id')::uuid) then raise exception 'RECEIPT_NOT_IDEMPOTENT';end if;
end loop;
if public.claim_jls_restaurant_task(rid,'MOCK') is not null then raise exception 'CAP_EXCEEDED';end if;
if public.stage_jls_restaurant(rid,'MOCK','sol','[]') then raise exception 'SOL_STAGE_ALLOWED';end if;
body='{"explicit_technical_mock":true}';
if not public.save_jls_restaurant_artifact(rid,'MOCK','native_classification_comparison',body,public.jls_restaurant_hash(body))
or not public.stage_jls_restaurant(rid,'MOCK','completed','[]') then raise exception 'FINALIZATION_FAILED';end if;
if public.begin_jls_restaurant_dispatch((t->>'id')::uuid,'MOCK',t->>'request_sha256') then raise exception 'TERMINAL_RETRY';end if;
perform set_config('luna.native.test',jsonb_build_object('passed',true,'claims',87,'claim_sql_ms',timings,'provider_calls',0,'paid_run_created',false)::text,true);
end $$;
set local role authenticated;
do $$begin if has_function_privilege('authenticated','public.authorize_luna_direct4_comparison(uuid,jsonb,text)','execute') or has_function_privilege('authenticated','public.save_luna_direct4_comparison(jsonb,text)','execute') then raise exception 'CLIENT_WRITE_EXPOSED';end if;end $$;
select current_setting('luna.native.test')::jsonb result;
rollback;