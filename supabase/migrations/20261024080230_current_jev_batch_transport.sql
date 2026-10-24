-- Ship disabled. Selection, JEV rules and Sol wire stay frozen; only JEV transport changes.
alter table public.report_pipeline_settings add column jev_transport text not null default 'individual' check(jev_transport in('individual','batch_initial_v1'));
alter table public.report_generation_requests add column jev_transport text not null default 'individual' check(jev_transport in('individual','batch_initial_v1'));
alter table public.report_pipeline_events add column jev_transport text not null default 'individual';
alter table public.analysis_jev_batch_runs alter column baseline_report_id drop not null;
alter table public.analysis_jev_batch_runs add column current_source_run_id uuid unique references public.historical_report_runs(id);
alter table public.analysis_jev_batch_runs add column manifest jsonb;
alter table public.analysis_jev_batch_runs add constraint batch_origin check((baseline_report_id is not null and current_source_run_id is null) or (baseline_report_id is null and current_source_run_id is not null));
alter table public.analysis_jev_batch_tasks add column input_tokens bigint check(input_tokens>=0);
alter table public.analysis_jev_batch_tasks add column output_tokens bigint check(output_tokens>=0);
alter table public.analysis_jev_batch_tasks add column duration_ms double precision check(duration_ms>=0);
alter table public.analysis_jev_batch_tasks add column served_model text;
alter table public.analysis_jev_batch_tasks add column provider_request_id text;

create function public.set_current_jev_transport(p_transport text,p_reason text) returns text language plpgsql set search_path='' as $$
declare e text;begin
 if current_user<>'service_role' or p_transport not in('individual','batch_initial_v1') or length(btrim(p_reason))<12 then raise exception 'FORBIDDEN';end if;
 select engine into e from public.report_pipeline_settings where id for update;
 if p_transport='batch_initial_v1' and e<>'jev_sol_v2' then raise exception 'CURRENT_V2_REQUIRED';end if;
 update public.report_pipeline_settings set jev_transport=p_transport,reason=p_reason,updated_at=now() where id;
 insert into public.report_pipeline_events(engine,jev_transport,reason) values(e,p_transport,p_reason);
 return p_transport;
end $$;

-- Snapshot the transport at enqueue. Existing requests are immutable, including on rollback.
do $$declare d text;a text;begin
 d=pg_get_functiondef('public.enqueue_current_report(uuid,uuid,uuid,text,uuid,text,integer)'::regprocedure);
 a='declare r public.historical_report_runs;q public.report_generation_requests;e text;';
 if position(a in d)=0 then raise exception 'BATCH_ENQUEUE_DECLARATION_CHANGED';end if;
 d=replace(d,a,a||'jt text;');
 a=' select engine into e from public.report_pipeline_settings where id for share;';
 if position(a in d)=0 then raise exception 'BATCH_ENQUEUE_SETTING_CHANGED';end if;
 d=replace(d,a,' if exists(select 1 from public.analysis_jev_batch_runs br join public.analysis_parallel_reports bp on bp.id=br.report_id where br.current_source_run_id is not null and bp.establishment_id=p_establishment and bp.language=p_language and (br.status=''billing_uncertain'' or exists(select 1 from public.analysis_jev_batch_tasks bt where bt.run_id=br.id and bt.status=''unknown''))) then raise exception ''REPORT_PREVIOUS_OUTCOME_UNCERTAIN'';end if;
 select engine,jev_transport into e,jt from public.report_pipeline_settings where id for share;');
 a='insert into public.report_generation_requests(id,organization_id,establishment_id,authority_user_id,language,engine,source_run_id) values(p_request,p_organization,p_establishment,p_user,p_language,e,r.id);';
 if position(a in d)=0 then raise exception 'BATCH_ENQUEUE_INSERT_CHANGED';end if;
 d=replace(d,a,'insert into public.report_generation_requests(id,organization_id,establishment_id,authority_user_id,language,engine,source_run_id,jev_transport) values(p_request,p_organization,p_establishment,p_user,p_language,e,r.id,case when e=''jev_sol_v2'' then jt else ''individual'' end);');execute d;
 -- Free individual source certification is reused, but its paid dispatcher may
 -- never consume a generation whose frozen transport is batches.
 d=pg_get_functiondef('public.start_parallel_report_internal(jsonb,text,uuid,jsonb)'::regprocedure);
 a='if rq.id is null or not certified or src.requested_by<>p_user then';
 if position(a in d)=0 then raise exception 'BATCH_INDIVIDUAL_START_ANCHOR_CHANGED';end if;
 execute replace(d,a,'if rq.jev_transport is distinct from ''individual'' then raise exception ''CURRENT_V2_TRANSPORT_CHANGED'';end if; '||a);
end $$;

create function public.jev_batch_create_current(p_source uuid,p_manifest jsonb,p_sha text) returns uuid language plpgsql set search_path='' set jit='off' as $$
declare q public.report_generation_requests;s public.historical_report_runs;c public.analysis_parallel_launch_preparations;
 r uuid;v uuid;b jsonb;payload jsonb;expected_avis jsonb;expected_mapping jsonb;expected_questions jsonb;ids jsonb;actual_ids jsonb;rq jsonb;n int;
begin
 if current_user<>'service_role' or public.jls_restaurant_hash(p_manifest) is distinct from p_sha then raise exception 'FORBIDDEN';end if;
 select * into q from public.report_generation_requests where source_run_id=p_source for update;
 if q.id is null or q.engine<>'jev_sol_v2' or q.jev_transport<>'batch_initial_v1' then raise exception 'CURRENT_BATCH_REQUEST_REQUIRED';end if;
 select id into r from public.analysis_jev_batch_runs where current_source_run_id=p_source;
 if r is not null then
  if not exists(select 1 from public.analysis_jev_batch_runs where id=r and manifest_sha256=p_sha and manifest=p_manifest) then raise exception 'CURRENT_BATCH_MANIFEST_CHANGED';end if;
  return r;
 end if;
 select * into s from public.historical_report_runs where id=p_source for update;
 select * into c from public.analysis_parallel_launch_preparations where current_source_run_id=s.id and sha256=p_manifest->>'source_protocol_sha256';
 if s.status not in('queued','running','retry') or s.created_at+interval '24 hours'<=now() or q.comparison_id is not null or c.id is null
 or not exists(select 1 from public.organization_members where organization_id=q.organization_id and user_id=q.authority_user_id and role in('owner','admin','manager')) then raise exception 'CURRENT_BATCH_CERTIFICATE_REQUIRED';end if;
 if not coalesce(p_manifest->>'version'='jev-current-batches-initial-v1' and p_manifest->>'transport'='batch_initial_v1'
 and p_manifest->>'organization_id'=q.organization_id::text and p_manifest->>'establishment_id'=q.establishment_id::text
 and p_manifest->>'authority_user_id'=q.authority_user_id::text and p_manifest->>'language'=q.language
 and p_manifest->'current_delivery'=c.body->'current_delivery' and p_manifest->'reference'=c.body->'reference'
 and p_manifest->'snapshot'=c.body->'source_snapshot' and p_manifest->>'snapshot_sha256'=c.body->>'source_snapshot_sha256'
 and p_manifest->'frozen_report'=c.body->'frozen_report'
 and p_manifest#>'{configuration,selector}'=c.body#>'{configuration,evidence_selector}'
 and p_manifest#>>'{configuration,sol_wire}'='jls-direct4-compact-sol-v1'
 and p_manifest#>>'{configuration,jev,version}'='jev-multi-review-initial-v1'
 and p_manifest#>>'{configuration,jev,model}'='jev-1.13.0'
 and p_manifest#>>'{configuration,jev,automatic_retry}'='false' and p_manifest#>>'{configuration,jev,max_attempts_per_batch}'='1'
 and p_manifest#>>'{configuration,jev,target_reviews}'='50' and p_manifest#>'{configuration,jev,confidence_threshold}'='null'::jsonb
 and p_manifest#>>'{configuration,jev,common_instructions_sha256}'='3a82a9c032217a0d10ba8a9ceccdafb71bc702366145d5837a324af580c20d22'
 and p_manifest->>'automatic_retry'='false' and p_manifest->>'max_sol_calls'='1' and p_manifest->>'max_luna_calls'='0' and p_manifest->>'max_apify_calls'='0'
 and jsonb_typeof(p_manifest->'plans')='array' and jsonb_array_length(p_manifest->'plans')>0
 and (p_manifest->>'max_new_jev_calls')::int=jsonb_array_length(p_manifest->'plans'),false) then raise exception 'CURRENT_BATCH_CONFIGURATION_CHANGED';end if;
 rq=(p_manifest#>>'{template,request_json}')::jsonb;
 if not coalesce(rq->>'model'='gpt-6.1-sol' and rq#>>'{reasoning,effort}'='low' and rq->>'max_output_tokens'='9500'
 and rq#>>'{text,format,name}'='jls_direct4_compact_sol_v1' and rq#>>'{text,format,strict}'='true'
 and public.jls_restaurant_hash(rq#>'{text,format,schema}')='a479cb3b10c97557ee750e9484118629bfe8f6580edc945e31d6d864793d194c'
 and encode(extensions.digest(rq#>>'{input,0,content}','sha256'),'hex')=case q.language when 'fr' then '2b27ff48b9d0de25e92af4e640fb60dd75b9eccbe0b4ecc109b2955c531aae37' else '8aac8e2a06d412ca0425a00b919c03a89490a94c13e4462e6f9119dd60569c86' end
 and p_manifest#>>'{template,packet,language}'=q.language,false) then raise exception 'CURRENT_BATCH_SOL_TEMPLATE_CHANGED';end if;
 if rq is distinct from jsonb_build_object('model','gpt-6.1-sol','reasoning',jsonb_build_object('effort','low'),'max_output_tokens',9500,
  'input',jsonb_build_array(jsonb_build_object('role','system','content',rq#>>'{input,0,content}'),jsonb_build_object('role','user','content','{}')),
  'text',jsonb_build_object('format',jsonb_build_object('type','json_schema','name','jls_direct4_compact_sol_v1','strict',true,'schema',rq#>'{text,format,schema}')))
  then raise exception 'CURRENT_BATCH_SOL_PARAMETERS_CHANGED';end if;
 select jsonb_agg(x->>'id' order by x->>'id') into ids from jsonb_array_elements(c.body#>'{source_snapshot,reviews}') x where nullif(x->>'analysis_text','') is not null;
 select jsonb_object_agg(g::text,(select count(*) from jsonb_array_elements(c.body#>'{source_snapshot,reviews}') x where (x->>'rating')::int=g)) into expected_mapping from generate_series(1,5) g;
 select jsonb_object_agg(g::text,(select count(*) from jsonb_array_elements(c.body#>'{source_snapshot,reviews}') x where (x->>'rating')::int=g and nullif(x->>'analysis_text','') is not null)) into expected_questions from generate_series(1,5) g;
 expected_avis=jsonb_build_object('scope',jsonb_build_object('source_reviews',jsonb_array_length(c.body#>'{source_snapshot,reviews}'),'analysed_text_reviews',jsonb_array_length(ids),'textless_statistics_only',jsonb_array_length(c.body#>'{source_snapshot,reviews}')-jsonb_array_length(ids)),
  'counts','{}'::jsonb,'star_distribution_all',expected_mapping,'star_distribution_analysed',expected_questions,'categories',p_manifest#>'{template,statistics,categories}','uncertainty_preserved',true,'frequency_unit','distinct_review_per_category_not_specific_incident');
 if p_manifest#>'{template,statistics}' is distinct from expected_avis or public.jls_restaurant_hash(p_manifest#>'{template,statistics,categories}') is distinct from '970e557234f509df3254c2c84f5a298e704cd5c241acb1b850b2cbb56da841e0' then raise exception 'CURRENT_BATCH_STATISTICS_TEMPLATE_CHANGED';end if;
 select jsonb_agg(i.id order by i.id) into actual_ids from jsonb_array_elements(p_manifest->'plans') p cross join lateral jsonb_array_elements_text(p->'review_ids') i(id);
 if ids is distinct from actual_ids then raise exception 'CURRENT_BATCH_REVIEW_SET_CHANGED';end if;
 n=0;
 for b in select value from jsonb_array_elements(p_manifest->'plans') loop
  n=n+1;payload=(b->>'request_wire')::jsonb;
  if not coalesce((b->>'number')::int=n and (b->>'reviews')::int between 1 and 50
   and jsonb_array_length(b->'review_ids')=(b->>'reviews')::int
   and b#>>'{preflight,passed}'='true' and b#>>'{preflight,truncated_reviews}'='0'
   and (b#>>'{preflight,guarded_total_tokens}')::int<=64000 and (b#>>'{preflight,guarded_largest_pair_tokens}')::int<=32000
   and octet_length(b->>'request_wire')<=33554432 and b->>'request_sha256'=encode(extensions.digest(b->>'request_wire','sha256'),'hex')
   and public.jls_restaurant_hash(payload#>'{state,consignes_communes}')='3a82a9c032217a0d10ba8a9ceccdafb71bc702366145d5837a324af580c20d22',false) then raise exception 'CURRENT_BATCH_REQUEST_GUARD_CHANGED';end if;
  select jsonb_object_agg('review_'||i.id,x->>'analysis_text') into expected_avis from jsonb_array_elements_text(b->'review_ids') i(id)
   join jsonb_array_elements(c.body#>'{source_snapshot,reviews}') x on x->>'id'=i.id;
  select jsonb_object_agg('r'||lpad(i.ord::text,3,'0')||'_'||cat,jsonb_build_object('review_id',i.id,'category',cat)),
   jsonb_object_agg('r'||lpad(i.ord::text,3,'0')||'_'||cat,jsonb_build_object('type','choice','instructions','Classe '||cat||' pour le seul avis review_'||i.id||' selon consignes_communes.',
    'criteria','{"positive":null,"negative":null,"mixed":null,"neutral":null,"uncertain":null,"not_mentioned":null}'::jsonb))
  into expected_mapping,expected_questions from jsonb_array_elements_text(b->'review_ids') with ordinality i(id,ord) cross join unnest(array['service','price','quality','ambiance']) cat;
  if b->'mapping' is distinct from expected_mapping or payload is distinct from jsonb_build_object('model','jev-1.13.0','state',jsonb_build_object('avis',expected_avis,'consignes_communes',payload#>'{state,consignes_communes}'),'questions',expected_questions)
   then raise exception 'CURRENT_BATCH_MAPPING_OR_TEXT_CHANGED';end if;
 end loop;
 v=gen_random_uuid();
 insert into public.analysis_parallel_reports(id,organization_id,establishment_id,reference_generation_id,current_source_run_id,language,configuration_version,corpus_sha256,source_report,source_reviews,state,statistics)
 values(v,q.organization_id,q.establishment_id,s.generation_id,s.id,q.language,'jev-multi-review-initial-v1',c.body#>>'{source_snapshot,source_reviews_sha256}',p_manifest->'frozen_report',p_manifest#>'{snapshot,reviews}','generating',jsonb_build_object('scope',jsonb_set(p_manifest#>'{template,statistics,scope}','{analysed_text_reviews}','0')));
 insert into public.analysis_jev_batch_runs(organization_id,establishment_id,current_source_run_id,report_id,snapshot,snapshot_sha256,template,manifest,manifest_sha256,source_manifest_sha256,authorization_evidence,expires_at,max_new_jev_calls,armed)
 values(q.organization_id,q.establishment_id,s.id,v,p_manifest->'snapshot',p_manifest->>'snapshot_sha256',p_manifest->'template',p_manifest,p_sha,p_sha,'Current report request '||q.id::text||'; one native attempt per frozen batch; no automatic retry.',s.created_at+interval '24 hours',n,true) returning id into r;
 insert into public.analysis_jev_batch_tasks(run_id,organization_id,number,reviews,request_wire,request_sha256,mapping,preflight)
 select r,q.organization_id,(b->>'number')::int,(b->>'reviews')::int,b->>'request_wire',b->>'request_sha256',b->'mapping',b->'preflight' from jsonb_array_elements(p_manifest->'plans') b;
 update public.report_generation_requests set comparison_id=v where id=q.id;
 update public.historical_report_runs set status='running',locked_by=null,lease_until=null,total_steps=n+1,updated_at=now() where id=s.id;
 perform public.jev_batch_wake(r);return r;
end $$;

-- Real usage is recorded once on each parent receipt, including invalid answers.
create function public.jev_batch_refresh_usage(p_run uuid) returns void language plpgsql set search_path='' as $$
declare r public.analysis_jev_batch_runs;j jsonb;begin
 select * into r from public.analysis_jev_batch_runs where id=p_run;
 select jsonb_build_object('new_provider_attempts',coalesce(sum(request_count),0),'reused_batches',count(*) filter(where historical_source is not null),
  'new_usage',jsonb_build_object('provider_attempts',coalesce(sum(request_count),0),'input_tokens',sum(input_tokens) filter(where request_count=1),
   'output_tokens',sum(output_tokens) filter(where request_count=1),'summed_provider_duration_ms',sum(duration_ms) filter(where request_count=1),
   'usage_complete',count(*) filter(where request_count=1 and (input_tokens is null or output_tokens is null))=0),
  'historical',coalesce(sum(request_count),0)=0) into j from public.analysis_jev_batch_tasks where run_id=p_run;
 update public.analysis_parallel_reports set usage=coalesce(usage,'{}')||jsonb_build_object('jev',j,'luna_calls',0,'apify_calls',0) where id=r.report_id;
 if r.current_source_run_id is not null then
  update public.historical_report_runs set ai_calls=(j->>'new_provider_attempts')::int,input_tokens=coalesce((j#>>'{new_usage,input_tokens}')::bigint,0),output_tokens=coalesce((j#>>'{new_usage,output_tokens}')::bigint,0),token_usage_complete=(j#>>'{new_usage,usage_complete}')::boolean,updated_at=now() where id=r.current_source_run_id;
 end if;
end $$;

create or replace function public.jev_batch_claim(p_run uuid,p_worker text) returns jsonb language plpgsql set search_path='' as $$
declare r public.analysis_jev_batch_runs;t public.analysis_jev_batch_tasks;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 -- Serializes only the short reservation transaction, never the HTTP request.
 perform pg_advisory_xact_lock(hashtextextended('jev-native-batch-account-slot-v1',0));
 select * into r from public.analysis_jev_batch_runs where id=p_run for update;
 if r.id is null or not r.armed or r.status<>'running' or r.expires_at<=now() then return null;end if;
 update public.analysis_jev_batch_tasks set status='unknown',error_code='BATCH_OUTCOME_UNKNOWN_NO_RETRY' where run_id=p_run and status='reserved' and lease_until<now();
 select * into t from public.analysis_jev_batch_tasks where run_id=p_run and (status='pending' and request_count=0 or status='received' and (lease_until is null or lease_until<now())) order by number for update skip locked limit 1;
 if t.id is null then
  if exists(select 1 from public.analysis_jev_batch_tasks where run_id=p_run and status in('unknown','invalid_output')) then
   perform public.jev_batch_refresh_usage(r.id);
   update public.analysis_jev_batch_runs set status='blocked',error_code='BATCH_INCOMPLETE_NO_SOL',armed=false where id=p_run;
   update public.analysis_parallel_reports set state='blocked',error_code='BATCH_INCOMPLETE_NO_SOL' where id=r.report_id;
  end if;return null;
 end if;
 if t.status='pending' then
  if exists(select 1 from public.analysis_jev_batch_tasks where status='reserved' and lease_until>now()) then return null;end if;
  if (select count(*) from public.analysis_jev_batch_tasks where run_id=p_run and request_count=1)>=r.max_new_jev_calls then raise exception 'BATCH_NEW_JEV_NOT_AUTHORIZED';end if;
  update public.analysis_jev_batch_tasks set status='reserved',request_count=1,reserved_at=now(),lease_until=now()+interval '150 seconds',worker=p_worker where id=t.id returning * into t;
  perform public.jev_batch_refresh_usage(r.id);
 else update public.analysis_jev_batch_tasks set worker=p_worker,lease_until=now()+interval '150 seconds' where id=t.id returning * into t;
 end if;return to_jsonb(t);
end $$;

create or replace function public.jev_batch_receive(p_task uuid,p_worker text,p_receipt jsonb,p_sha text) returns boolean language plpgsql set search_path='' as $$
declare t public.analysis_jev_batch_tasks;other uuid;begin
 if current_user<>'service_role' or public.jls_restaurant_hash(p_receipt) is distinct from p_sha then raise exception 'FORBIDDEN';end if;
 select * into t from public.analysis_jev_batch_tasks where id=p_task for update;
 if t.receipt is not null then return t.receipt_sha256=p_sha;end if;
 if t.status not in('reserved','unknown') or t.worker is distinct from p_worker or t.request_count<>1 or p_receipt->>'request_sha256' is distinct from t.request_sha256 then return false;end if;
 update public.analysis_jev_batch_tasks set receipt=p_receipt,receipt_sha256=p_sha,
  status=case when p_receipt->>'raw_response_text' is null then 'unknown' else 'received' end,
  error_code=case when p_receipt->>'raw_response_text' is null then 'BATCH_OUTCOME_UNKNOWN_NO_RETRY' else null end,lease_until=null,
  input_tokens=case when p_receipt#>>'{usage,input_tokens}' ~ '^[0-9]+$' then (p_receipt#>>'{usage,input_tokens}')::bigint else null end,
  output_tokens=case when p_receipt#>>'{usage,output_tokens}' ~ '^[0-9]+$' then (p_receipt#>>'{usage,output_tokens}')::bigint else null end,
  duration_ms=case when jsonb_typeof(p_receipt->'duration_ms')='number' then (p_receipt->>'duration_ms')::double precision else null end,
  served_model=p_receipt->>'served_model',provider_request_id=p_receipt->>'provider_request_id' where id=t.id;
 perform public.jev_batch_refresh_usage(t.run_id);perform public.jev_batch_wake(t.run_id);
 select id into other from public.analysis_jev_batch_runs br where current_source_run_id is not null and id<>t.run_id and armed and status='running' and expires_at>now()
  and exists(select 1 from public.analysis_jev_batch_tasks bt where bt.run_id=br.id and bt.status='pending' and bt.request_count=0) order by created_at limit 1;
 if other is not null then perform public.jev_batch_wake(other);end if;return true;
end $$;

create or replace function public.jev_batch_finish(p_run uuid,p_status text,p_result jsonb,p_usage jsonb,p_error text default null) returns boolean language plpgsql set search_path='' as $$
declare r public.analysis_jev_batch_runs;begin
 if current_user<>'service_role' or p_status not in('completed','needs_review','invalid_output','billing_uncertain') then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jev_batch_runs where id=p_run for update;
 if r.status<>'running' then return true;end if;
 if r.stage<>'validate_sol' or r.sol_receipt is null or r.sol_request_count<>1 then return false;end if;
 update public.analysis_parallel_reports set state=p_status,error_code=p_error,generated_at=now(),raw_response=p_result->'response',original_report=p_result->'original_report',derived_report=p_result->'derived_report',
  controls=p_result->'controls',corrections=p_result->'corrections',usage=p_usage||jsonb_build_object('wall_duration_ms',extract(epoch from(clock_timestamp()-r.created_at))*1000) where id=r.report_id and configuration_version='jev-multi-review-initial-v1' and current_source_run_id is not distinct from r.current_source_run_id;
 if not found then raise exception 'BATCH_PUBLICATION_BINDING_CHANGED';end if;
 if r.current_source_run_id is not null then
  update public.historical_report_runs set ai_calls=coalesce((p_usage#>>'{jev,new_provider_attempts}')::int,0)+1,
   input_tokens=coalesce((p_usage#>>'{jev,new_usage,input_tokens}')::bigint,0)+coalesce((p_usage#>>'{sol,usage,input_tokens}')::bigint,0),
   output_tokens=coalesce((p_usage#>>'{jev,new_usage,output_tokens}')::bigint,0)+coalesce((p_usage#>>'{sol,usage,output_tokens}')::bigint,0),
   token_usage_complete=coalesce((p_usage#>>'{jev,new_usage,usage_complete}')::boolean,false) and p_usage#>>'{sol,usage,input_tokens}' is not null,updated_at=now() where id=r.current_source_run_id;
 end if;
 update public.analysis_jev_batch_runs set status=p_status,error_code=p_error,completed_at=now(),armed=false where id=r.id;return true;
end $$;

create function public.jev_batch_stop(p_run uuid,p_error text) returns void language plpgsql set search_path='' as $$
declare r public.analysis_jev_batch_runs;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jev_batch_runs where id=p_run for update;
 if r.status='running' then
  perform public.jev_batch_refresh_usage(r.id);
  update public.analysis_jev_batch_runs set status='blocked',armed=false,error_code=p_error where id=r.id;
  update public.analysis_parallel_reports set state='blocked',error_code=p_error where id=r.report_id;
 end if;
end $$;

-- Lost wakes recover durable work, never reset a reservation or resend a consumed attempt.
create function public.jev_batch_recover() returns int language plpgsql set search_path='' as $$
declare r public.analysis_jev_batch_runs;n int=0;begin
 if current_user<>'service_role' and current_user<>'postgres' then raise exception 'FORBIDDEN';end if;
 for r in select * from public.analysis_jev_batch_runs where current_source_run_id is not null and armed and status='running' loop
  if r.expires_at<=now() then
   update public.analysis_jev_batch_tasks set status='unknown',error_code='BATCH_OUTCOME_UNKNOWN_NO_RETRY' where run_id=r.id and status='reserved' and receipt is null;
   update public.analysis_jev_batch_runs set status='authorization_expired',armed=false,error_code='BATCH_AUTHORIZATION_EXPIRED' where id=r.id;
   update public.analysis_parallel_reports set state='authorization_expired',error_code='BATCH_AUTHORIZATION_EXPIRED' where id=r.report_id;
  else perform public.jev_batch_wake(r.id);n=n+1;
  end if;
 end loop;return n;
end $$;
-- cron assumes service_role; wake remains restricted and never exposes credentials.
select cron.schedule('home-reviews-jev-batches-recovery-v1','* * * * *','set role service_role; select public.jev_batch_recover();');

create function public.guard_batch_frozen_data() returns trigger language plpgsql set search_path='' as $$begin
 if tg_table_name='analysis_jev_batch_tasks' then
  if (to_jsonb(new)-array['status','request_count','worker','lease_until','receipt','receipt_sha256','projection','projection_sha256','error_code','reserved_at','completed_at','input_tokens','output_tokens','duration_ms','served_model','provider_request_id'])
   is distinct from (to_jsonb(old)-array['status','request_count','worker','lease_until','receipt','receipt_sha256','projection','projection_sha256','error_code','reserved_at','completed_at','input_tokens','output_tokens','duration_ms','served_model','provider_request_id'])
   or new.request_count<old.request_count or old.receipt is not null and (new.receipt is distinct from old.receipt or new.receipt_sha256 is distinct from old.receipt_sha256
    or row(new.input_tokens,new.output_tokens,new.duration_ms,new.served_model,new.provider_request_id) is distinct from row(old.input_tokens,old.output_tokens,old.duration_ms,old.served_model,old.provider_request_id))
   or old.projection is not null and (new.projection is distinct from old.projection or new.projection_sha256 is distinct from old.projection_sha256)
   then raise exception 'BATCH_FROZEN_TASK_CHANGED';end if;
 else
  if new.snapshot is distinct from old.snapshot or new.snapshot_sha256 is distinct from old.snapshot_sha256 or new.template is distinct from old.template
   or new.manifest is distinct from old.manifest or new.manifest_sha256 is distinct from old.manifest_sha256 or new.source_manifest_sha256 is distinct from old.source_manifest_sha256
   or new.current_source_run_id is distinct from old.current_source_run_id or new.baseline_report_id is distinct from old.baseline_report_id or new.report_id<>old.report_id
   or new.organization_id<>old.organization_id or new.establishment_id<>old.establishment_id or new.configuration_version<>old.configuration_version
   or old.current_source_run_id is not null and row(new.max_new_jev_calls,new.expires_at,new.authorization_evidence) is distinct from row(old.max_new_jev_calls,old.expires_at,old.authorization_evidence)
   or new.sol_request_count<old.sol_request_count or old.envelope is not null and (new.envelope is distinct from old.envelope or new.envelope_sha256 is distinct from old.envelope_sha256)
   or old.sol_receipt is not null and (new.sol_receipt is distinct from old.sol_receipt or new.sol_receipt_sha256 is distinct from old.sol_receipt_sha256)
   then raise exception 'BATCH_FROZEN_RUN_CHANGED';end if;
 end if;return new;
end $$;
create trigger batch_task_frozen before update on public.analysis_jev_batch_tasks for each row execute function public.guard_batch_frozen_data();
create trigger batch_run_frozen before update on public.analysis_jev_batch_runs for each row execute function public.guard_batch_frozen_data();

revoke all on function public.set_current_jev_transport(text,text),public.jev_batch_create_current(uuid,jsonb,text),public.jev_batch_refresh_usage(uuid),public.jev_batch_stop(uuid,text),public.jev_batch_recover(),public.guard_batch_frozen_data() from public,anon,authenticated;
grant execute on function public.set_current_jev_transport(text,text),public.jev_batch_create_current(uuid,jsonb,text),public.jev_batch_refresh_usage(uuid),public.jev_batch_stop(uuid,text),public.jev_batch_recover(),public.guard_batch_frozen_data() to service_role;
