-- Supply jls.partial.fixture from the offline rehearsal using a transaction-local
-- GUC. Everything below, including explicit technical run/task fixtures, is
-- ROLLED BACK. No authorization RPC, HTTP, worker wake or committed consent/run.
set local role service_role;
do $$declare input jsonb=current_setting('jls.partial.fixture')::jsonb;p public.analysis_jls_restaurant_protocols;
 b jsonb=input->'prepared'->'body';pid uuid;rid uuid=gen_random_uuid();tid uuid;x jsonb;ev jsonb=input->'evidence';ds jsonb;prep jsonb;mock_consent jsonb;bad jsonb;m jsonb;evsha text;
begin
 if not public.check_jls_direct4_frozen_sources(b) then raise exception 'PARTIAL_SOURCE_INVALID';end if;
 pid=public.save_jls_restaurant_protocol(b,public.jls_restaurant_hash(b));
 if public.save_jls_restaurant_protocol(b,public.jls_restaurant_hash(b))<>pid then raise exception 'PARTIAL_NOT_IDEMPOTENT';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=pid;
 for x in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_set(b,'{max_jev_calls}','52'),jsonb_set(b,'{continuation,reused,0,body,served_model}','"invented"'),
  jsonb_set(b,'{continuation,missing,0,result}','{}'),jsonb_set(b,'{continuation,source_run_sha256}','"changed"'),
  jsonb_set(b,'{continuation,missing,0,source,analysis_text}','"changed"'),
  jsonb_set(b,'{configuration,jev,id}','"changed"')
 )) loop if public.check_jls_direct4_frozen_sources(x) then raise exception 'PARTIAL_BAD_MANIFEST_ACCEPTED';end if;end loop;
 begin perform public.authorize_jls_restaurant(pid,null,null);raise exception 'PARTIAL_NO_GO_ACCEPTED';
 exception when others then if sqlerrm not in('DIRECT4_HISTORICAL_DEPLOYED_QUALIFICATION_REQUIRED','DIRECT4_HISTORICAL_GO_SCOPE_CHANGED','JLS_NEW_GO_REQUIRED') then raise;end if;end;
 -- Explicit uncommitted technical fixture. No user directive is fabricated and
 -- authorize_jls_restaurant is never called with a consent. This run cannot be
 -- observed by a worker or scheduler outside this transaction.
 mock_consent=jsonb_build_object('explicit_technical_mock_rollback_only',true,'protocol_sha256',p.sha256,'consent_source','user_directive_codex_delegation');
 insert into public.analysis_jls_restaurant_runs(id,protocol_id,organization_id,consent,consent_sha256,expires_at,stage,status)
 values(rid,p.id,p.organization_id,mock_consent,public.jls_restaurant_hash(mock_consent),now()+interval '5 minutes','prepare_evidence','running');
 ev=replace(replace(ev::text,'EXPLICIT_MOCK_RUN',rid::text),'EXPLICIT_MOCK_PROTOCOL',pid::text)::jsonb;
 for x in select value from jsonb_array_elements(input->'new_mock_tasks') loop
  tid=gen_random_uuid();ev=replace(ev::text,to_jsonb(x->>'id')::text,to_jsonb(tid::text)::text)::jsonb;
  insert into public.analysis_jls_restaurant_tasks(id,run_id,organization_id,phase,task_key,review_id,request,request_sha256,identity,status,request_count,worker,completed_at)
  values(tid,rid,p.organization_id,'jev',x->>'review_id',(x->>'review_id')::uuid,
   (select (v->'payload')||jsonb_build_object('questions',p.body->'configuration'->'jev_request_template'->'questions') from jsonb_array_elements(p.body->'pending')v where v->>'review_id'=x->>'review_id'),
   x->>'request_sha256',x->'identity','completed',1,'EXPLICIT_TECHNICAL_MOCK',now());
  insert into public.analysis_jls_restaurant_artifacts(run_id,organization_id,kind,body,sha256)
  values(rid,p.organization_id,'task:'||tid,x->'outcome',public.jls_restaurant_hash(x->'outcome'));
 end loop;
 ds=ev->'dataset';ds=jsonb_set(ds,'{sha256}',to_jsonb(public.jls_restaurant_hash(ds->'body')));
 prep=ev->'preparation';prep=jsonb_set(prep,'{body,source_archive,sha256}',ds->'sha256');
 prep=jsonb_set(prep,'{sha256}',to_jsonb(public.jls_restaurant_hash(prep->'body')));
 ev=jsonb_set(jsonb_set(ev,'{dataset}',ds),'{preparation}',prep);
 evsha=public.jls_restaurant_hash(ev);
 m=b->'continuation'->'missing'->0;
 bad=jsonb_set(ev,'{preparation,body,selection,selected,0}',(prep->'body'->'selection'->'selected'->0)||
  jsonb_build_object('review_id',m->>'review_id','quote',m->'source'->>'analysis_text','context',m->'source'->>'analysis_text',
  'analysis_text_sha256',m->'source'->>'analysis_text_sha256','quote_sha256',m->'source'->>'analysis_text_sha256'));
 bad=jsonb_set(bad,'{preparation,sha256}',to_jsonb(public.jls_restaurant_hash(bad->'preparation'->'body')));
 if public.bind_jls_direct4_historical_evidence(rid,ev,evsha) then raise exception 'MISSING_CERTIFICATE_ACCEPTED';end if;
 perform set_config('jls.partial.certificate_start',clock_timestamp()::text,true);
 perform public.save_jls_direct4_partial_evidence_certificate(rid,ev,evsha);
 perform set_config('jls.partial.certificate_ms',(extract(epoch from clock_timestamp()-current_setting('jls.partial.certificate_start')::timestamptz)*1000)::text,true);
 perform public.save_jls_direct4_partial_evidence_certificate(rid,bad,public.jls_restaurant_hash(bad));
 if public.bind_jls_direct4_historical_evidence(rid,bad,public.jls_restaurant_hash(bad)) then raise exception 'MISSING_SOURCE_USED_AS_EVIDENCE';end if;
 perform set_config('jls.partial.bind_start',clock_timestamp()::text,true);
 if not public.bind_jls_direct4_historical_evidence(rid,ev,evsha) then raise exception 'PARTIAL_REAL_EVIDENCE_BINDING_FAILED';end if;
 perform set_config('jls.partial.bind_ms',(extract(epoch from clock_timestamp()-current_setting('jls.partial.bind_start')::timestamptz)*1000)::text,true);
 if (select count(*) from public.analysis_jls_restaurant_tasks where run_id=rid and phase='jev')<>51 then raise exception 'REUSED_RESULTS_RECREATED_AS_ATTEMPTS';end if;
 if exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=rid and review_id in(select (value->>'review_id')::uuid from jsonb_array_elements(b->'continuation'->'missing'))) then raise exception 'UNKNOWN_REDISPATCHED';end if;
 if (select count(*) from public.analysis_jls_restaurant_tasks where run_id=rid and phase='luna')>32 then raise exception 'LUNA_CAP_EXCEEDED';end if;
 if (select stage from public.analysis_jls_restaurant_runs where id=rid)<>'luna' then raise exception 'PARTIAL_STAGE_FAILED';end if;
 if prep->'body'->'statistics'->'scope'<>'{"source_reviews":100,"analysed_text_reviews":87,"textless_statistics_only":9,"technical_missing_reviews":4,"textual_source_reviews":91}'::jsonb then raise exception 'PARTIAL_DENOMINATORS_CHANGED';end if;
 begin update public.analysis_jls_restaurant_protocols set body=body-'continuation' where id=pid;raise exception 'PARTIAL_MUTABLE';
 exception when others then if sqlerrm<>'EVIDENCE_AUDIT_IMMUTABLE' then raise;end if;end;
 perform set_config('jls.partial.user',p.authority_user_id::text,true);perform set_config('jls.partial.pid',pid::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('jls.partial.user'),true);
do $$begin
 if not exists(select 1 from public.analysis_jls_restaurant_protocols where id=current_setting('jls.partial.pid')::uuid) then raise exception 'PARTIAL_OWNER_READ_FAILED';end if;
 if has_function_privilege('authenticated','public.check_jls_direct4_partial_sources(jsonb)','execute') or has_function_privilege('authenticated','public.save_jls_direct4_partial_evidence_certificate(uuid,jsonb,text)','execute') then raise exception 'PARTIAL_SERVER_FUNCTION_PUBLIC';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
do $$begin if exists(select 1 from public.analysis_jls_restaurant_protocols where id=current_setting('jls.partial.pid')::uuid) then raise exception 'PARTIAL_CROSS_ORG_READ';end if;end $$;
select current_setting('jls.partial.bind_ms')::numeric binding_ms,current_setting('jls.partial.certificate_ms')::numeric certificate_ms,'passed' sql_rls_result;
