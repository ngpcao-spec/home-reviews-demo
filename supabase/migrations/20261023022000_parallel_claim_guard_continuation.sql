-- Keep the authorization predicates, but avoid compiling their large query
-- plans on every short reservation RPC. No timeout or supplier limit changes.
alter function public.jls_restaurant_valid(uuid) set jit='off';
alter function public.claim_jls_restaurant_task(uuid,text) set jit='off';
alter function public.claim_parallel_report_task(uuid,text) set jit='off';
do $$declare d text;anchor text;begin
 d=pg_get_functiondef('public.claim_parallel_report_task(uuid,text)'::regprocedure);
 anchor='(p.body->>''max_jev_calls'')::int else 1 end';
 if position(anchor in d)=0 then raise exception 'PARALLEL_CLAIM_LIMIT_ANCHOR_CHANGED';end if;
 d=replace(d,anchor,'least((p.body->>''max_jev_calls'')::int,coalesce((r.consent#>>''{continuation,max_new_jev_calls}'')::int,(p.body->>''max_jev_calls'')::int)) else 1 end');
 execute d;
end $$;

-- A supplier-free, explicit administrative continuation. It cannot reopen a
-- terminal run or repeat a reserved task. The original grant's expiry remains.
create function public.continue_parallel_report_unattempted(p_source_run uuid) returns uuid
language plpgsql set search_path='' set jit='off' as $$
declare oldr public.analysis_jls_restaurant_runs;oldp public.analysis_jls_restaurant_protocols;
 oldpair public.analysis_parallel_reports;pair uuid;pid uuid;rid uuid;c jsonb;manifest jsonb;b jsonb;protocol_digest text;remaining int;acquired int;key text;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('parallel-unattempted:'||p_source_run,0));
 select * into oldr from public.analysis_jls_restaurant_runs where id=p_source_run for share;
 select * into oldp from public.analysis_jls_restaurant_protocols where id=oldr.protocol_id;
 select * into oldpair from public.analysis_parallel_reports where run_id=oldr.id;
 key='jls-direct4-parallel-no-luna-v1:continuation:'||p_source_run;
 select id into pair from public.analysis_parallel_reports where organization_id=oldr.organization_id
 and reference_report_id=oldpair.reference_report_id and reference_generation_id=oldpair.reference_generation_id
 and language=oldpair.language and configuration_version=key;
 if pair is not null then return pair;end if;
 if oldr.id is null or oldpair.id is null or oldr.status<>'blocked' or oldr.error_code<>'JLS_DATABASE_FAILED'
 or oldr.stage<>'jev' or oldr.expires_at<=now() or oldr.worker is not null or oldr.lease_until is not null
 or oldp.body->>'version'<>'jls-direct4-parallel-no-luna-v1'
 or oldr.consent->>'consent_source' is distinct from 'user_directive_codex_delegation'
 or oldr.consent_sha256<>public.jls_restaurant_hash(oldr.consent)
 or oldr.consent->>'protocol_sha256' is distinct from oldp.sha256
 or oldp.organization_id<>oldr.organization_id or oldpair.organization_id<>oldr.organization_id
 or oldpair.establishment_id<>oldp.establishment_id
 or not exists(select 1 from public.organization_members where organization_id=oldr.organization_id and user_id=oldp.authority_user_id and role in('owner','admin','manager'))
 or not exists(select 1 from public.historical_establishment_reports h where h.id=oldpair.reference_report_id and to_jsonb(h)=oldpair.source_report)
 or exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=oldr.id and
  (phase<>'jev' or not ((status='completed' and request_count=1) or (status='reused' and request_count=0) or (status='pending' and request_count=0))))
 or exists(select 1 from public.analysis_jls_sol_ready_operations where run_id=oldr.id)
 then raise exception 'PARALLEL_CONTINUATION_NOT_SAFE';end if;
 select count(*) filter(where status='pending'),count(*) filter(where status in('completed','reused')) into remaining,acquired
 from public.analysis_jls_restaurant_tasks where run_id=oldr.id;
 if remaining<=0 or remaining+acquired<>(oldp.body->>'max_jev_calls')::int
 or exists(select 1 from public.analysis_jls_restaurant_tasks t where t.run_id=oldr.id and t.status='pending'
  and exists(select 1 from public.analysis_jls_task_dispatch_intents i where i.task_id=t.id))
 or exists(select 1 from public.analysis_jls_restaurant_tasks t left join public.analysis_jls_restaurant_artifacts a on a.run_id=t.run_id and a.kind='task:'||t.id
  where t.run_id=oldr.id and t.status in('completed','reused') and (a.id is null or a.body->>'provider_fetch_invoked' is distinct from 'true' or a.body->>'provider_response_received' is distinct from 'true'
   or a.body->>'raw_response_text' is null or a.body->>'request_sha256' is distinct from t.request_sha256 or a.body#>>'{direct4_result,model}' is distinct from 'jev-1.13.0'
   or t.identity->>'configuration_sha256' is distinct from oldp.body->>'classification_configuration_sha256'))
 then raise exception 'PARALLEL_CONTINUATION_RECEIPTS_CHANGED';end if;
 select jsonb_agg(jsonb_build_object('review_id',t.review_id,'task_id',t.id,'status',t.status,'request_count',t.request_count,'request_sha256',t.request_sha256,'artifact_sha256',a.sha256) order by t.review_id) into manifest
 from public.analysis_jls_restaurant_tasks t left join public.analysis_jls_restaurant_artifacts a on a.run_id=t.run_id and a.kind='task:'||t.id where t.run_id=oldr.id;
 b=oldp.body||jsonb_build_object('operational_continuation',jsonb_build_object('source_run_id',oldr.id,'source_protocol_id',oldp.id,'source_protocol_sha256',oldp.sha256,'source_manifest',manifest,'source_manifest_sha256',public.jls_restaurant_hash(manifest),'max_new_jev_calls',remaining));
 protocol_digest=public.jls_restaurant_hash(b);
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256)
 values(oldp.organization_id,oldp.establishment_id,oldp.authority_user_id,b,protocol_digest) returning id into pid;
 c=oldr.consent||jsonb_build_object('protocol_id',pid,'protocol_sha256',protocol_digest,'continuation',jsonb_build_object('source_run_id',oldr.id,'source_protocol_id',oldp.id,
  'source_run_sha256',public.jls_restaurant_hash(to_jsonb(oldr)),'source_manifest_sha256',public.jls_restaurant_hash(manifest),
  'max_new_jev_calls',remaining,'reused_results',acquired,'created_at',now(),'grant_expiry_unchanged',true));
 insert into public.analysis_jls_restaurant_runs(protocol_id,organization_id,consent,consent_sha256,expires_at)
 values(pid,oldr.organization_id,c,public.jls_restaurant_hash(c),oldr.expires_at) returning id into rid;
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256,identity,status,completed_at)
 select rid,organization_id,'jev',task_key,review_id,request,request_sha256,identity,case when status='pending' then 'pending' else 'reused' end,
 case when status='pending' then null else now() end from public.analysis_jls_restaurant_tasks where run_id=oldr.id;
 insert into public.analysis_jls_restaurant_artifacts(run_id,organization_id,kind,body,sha256)
 select rid,t.organization_id,'task:'||t.id,a.body,a.sha256 from public.analysis_jls_restaurant_tasks t
 join public.analysis_jls_restaurant_tasks prior on prior.run_id=oldr.id and prior.review_id=t.review_id
 join public.analysis_jls_restaurant_artifacts a on a.run_id=prior.run_id and a.kind='task:'||prior.id where t.run_id=rid and t.status='reused';
 insert into public.analysis_parallel_reports(organization_id,establishment_id,reference_report_id,reference_generation_id,language,configuration_version,protocol_id,run_id,corpus_sha256,source_report,source_reviews)
 values(oldpair.organization_id,oldpair.establishment_id,oldpair.reference_report_id,oldpair.reference_generation_id,oldpair.language,key,pid,rid,oldpair.corpus_sha256,oldpair.source_report,oldpair.source_reviews)
 returning id into pair;
 if not public.jls_restaurant_valid(rid) then raise exception 'PARALLEL_CONTINUATION_AUTHORIZATION_INVALID';end if;
 return pair;
end $$;
revoke all on function public.continue_parallel_report_unattempted(uuid) from public,anon,authenticated;
grant execute on function public.continue_parallel_report_unattempted(uuid) to service_role;
