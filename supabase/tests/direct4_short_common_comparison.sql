begin;set local role service_role;set local jit=off;
do $$declare p public.analysis_jls_restaurant_protocols;rid uuid=gen_random_uuid();qid uuid=gen_random_uuid();c jsonb;v jsonb;t jsonb;b jsonb;wire text;tasks jsonb;timings jsonb='[]';at timestamptz;phase_name text;begin
select * into p from public.analysis_jls_restaurant_protocols where id='c592870c-ee7e-410c-897e-4a9544d3f7da';
if not public.check_jls_source_certificate(p.id) then raise exception 'SOURCE_CERTIFICATE';end if;
begin perform public.authorize_short_common_comparison(p.id,'{}',public.jls_restaurant_hash('{}'));raise exception 'NO_GO_ACCEPTED';
exception when others then if sqlerrm<>'SHORT_COMPARISON_DELEGATION_REQUIRED' then raise;end if;end;
if public.check_short_common_comparison_sources(jsonb_set(p.body,'{items,0,analysis_text}','"WRONG TEXT"'))
or public.check_short_common_comparison_sources(jsonb_set(p.body,'{configuration,rules}','"WRONG RULES"'))
then raise exception 'BAD_SOURCE_OR_RULES_ACCEPTED';end if;
insert into public.analysis_jls_sql_qualifications(id,protocol_id,organization_id,protocol_sha256,run_id,nonce,expires_at)
values(qid,p.id,p.organization_id,p.sha256,rid,'short_common_174_rollback',now()+interval '2 hours');
c=jsonb_build_object('consent_source','technical_qualification_no_spending','qualification_id',qid,'protocol_sha256',p.sha256,'provider_calls',0);
insert into public.analysis_jls_restaurant_runs(id,protocol_id,organization_id,stage,consent,consent_sha256,expires_at)
values(rid,p.id,p.organization_id,'jev',c,public.jls_restaurant_hash(c),now()+interval '2 hours');
for v in select value from jsonb_array_elements(p.body->'items') loop
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256,identity)
 values(rid,p.organization_id,'jev',v->>'review_id',(v->>'review_id')::uuid,v->'jev_request',v->>'jev_request_sha256',
 jsonb_build_object('expected_served_model','jev-1.13.0','configuration_sha256',p.body->>'configuration_sha256'));
end loop;
if public.claim_jls_restaurant_task(rid,null) is not null then raise exception 'NULL_LEASE';end if;
if not public.claim_jls_restaurant_tick(rid,'MOCK') or public.claim_jls_restaurant_tick(rid,'OTHER') then raise exception 'LEASE_NOT_EXCLUSIVE';end if;
foreach phase_name in array array['jev','luna'] loop
 for n in 1..87 loop
  at=clock_timestamp();t=public.claim_jls_restaurant_task(rid,'MOCK');timings=timings||jsonb_build_array(jsonb_build_object('phase',phase_name,'ms',extract(epoch from clock_timestamp()-at)*1000));
  if t is null or t->>'request_count'<>'1' or t->>'phase'<>phase_name then raise exception 'CLAIM_FAILED';end if;
  if not public.begin_jls_restaurant_dispatch((t->>'id')::uuid,'MOCK',t->>'request_sha256')
  or public.begin_jls_restaurant_dispatch((t->>'id')::uuid,'MOCK',t->>'request_sha256') then raise exception 'DUPLICATE_DISPATCH';end if;
  b=jsonb_build_object('phase',phase_name,'request_sha256',t->>'request_sha256','explicit_technical_mock',true,
  'raw_response_text','{"EXPLICIT_MOCK":true}','raw_response_sha256',encode(extensions.digest('{"EXPLICIT_MOCK":true}','sha256'),'hex'));
  v=jsonb_build_object('version','jls-restaurant-receipt-v1','source_kind','provider_outcome','task_id',t->>'id','worker','MOCK','protocol_sha256',p.sha256,'status','completed','body',b,'sha256',public.jls_restaurant_hash(b));wire=v::text;
  if not public.save_jls_restaurant_receipt((t->>'id')::uuid,'MOCK',wire,encode(extensions.digest(wire,'sha256'),'hex'))
  or not public.finish_jls_restaurant_receipt((t->>'id')::uuid)
  or not public.finish_jls_restaurant_receipt((t->>'id')::uuid) then raise exception 'PERSISTENCE_NOT_IDEMPOTENT';end if;
 end loop;
 if public.claim_jls_restaurant_task(rid,'MOCK') is not null then raise exception 'CAP_EXCEEDED';end if;
 if public.stage_jls_restaurant(rid,'MOCK','sol','[]') then raise exception 'SOL_ALLOWED';end if;
 if phase_name='jev' then
  select jsonb_build_object('luna_groups',jsonb_agg(jsonb_build_object('review_id',value->>'review_id','request_sha256',value->>'luna_request_sha256'))),
  jsonb_agg(jsonb_build_object('review_id',value->>'review_id','request',value->'luna_request','request_sha256',value->>'luna_request_sha256'))
  into b,tasks from jsonb_array_elements(p.body->'items');
  if not public.save_jls_restaurant_artifact(rid,'MOCK','evidence_plan',b,public.jls_restaurant_hash(b))
  or not public.stage_jls_restaurant(rid,'MOCK','luna',tasks) then raise exception 'LUNA_STAGE_FAILED';end if;
 else
  b='{"explicit_technical_mock":true}';
  if not public.save_jls_restaurant_artifact(rid,'MOCK','short_common_classification_comparison',b,public.jls_restaurant_hash(b))
  or not public.stage_jls_restaurant(rid,'MOCK','completed','[]') then raise exception 'FINALIZATION_FAILED';end if;
 end if;
end loop;
if public.begin_jls_restaurant_dispatch((t->>'id')::uuid,'MOCK',t->>'request_sha256') then raise exception 'TERMINAL_RETRY';end if;
perform set_config('short.common.test',jsonb_build_object('passed',true,'jev_claims',87,'luna_claims',87,'claim_sql_ms',timings,'provider_calls',0,'paid_run_created',false)::text,true);
end $$;
set local role authenticated;
do $$begin if has_function_privilege('authenticated','public.authorize_short_common_comparison(uuid,jsonb,text)','execute')
or has_function_privilege('authenticated','public.save_short_common_comparison(jsonb,text)','execute')
then raise exception 'CLIENT_WRITE_EXPOSED';end if;end $$;
select current_setting('short.common.test')::jsonb result;
rollback;
