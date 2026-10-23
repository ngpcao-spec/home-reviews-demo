-- Disposition comes from immutable server receipts, never from publication state.
create function public.parallel_recovery_rows(p_run uuid)
returns table(task_id uuid,review_id uuid,source_status text,request_count int,request_sha256 text,disposition text,body jsonb,body_sha256 text,receipt_wire_sha256 text,proof text)
language sql stable set search_path='' set jit='off' as $$
 with source as materialized(
  select t.*,p.sha256 protocol_sha,p.body->>'classification_configuration_sha256' config_sha,a.body ab,a.sha256 ah,
   x.wire::jsonb v,x.wire,x.wire_sha256,x.outcome_status,x.outcome_sha256,x.protocol_sha256 xp,x.request_sha256 xr,
   exists(select 1 from public.analysis_jls_task_dispatch_intents i where i.task_id=t.id) intent
  from public.analysis_jls_restaurant_tasks t join public.analysis_jls_restaurant_runs r on r.id=t.run_id
  join public.analysis_jls_restaurant_protocols p on p.id=r.protocol_id
  left join public.analysis_jls_restaurant_artifacts a on a.run_id=t.run_id and a.kind='task:'||t.id
  left join public.analysis_jls_task_receipts x on x.task_id=t.id
  where current_user='service_role' and t.run_id=p_run and t.phase='jev'),
 checked as materialized(select *,coalesce(ab,v->'body') outcome,
  wire_sha256=encode(extensions.digest(wire,'sha256'),'hex') and xp=protocol_sha and xr=request_sha256
   and v->>'task_id'=id::text and v->>'worker'=worker and v->>'sha256'=outcome_sha256 as receipt_valid from source),
 final as(select *,outcome->>'request_sha256'=request_sha256 and outcome#>>'{direct4_result,model}'='jev-1.13.0'
   and outcome->>'served_model'='jev-1.13.0' and identity->>'configuration_sha256'=config_sha
   and outcome->>'provider_fetch_invoked'='true' and outcome->>'provider_response_received'='true'
   and outcome->>'raw_response_sha256'=encode(extensions.digest(outcome->>'raw_response_text','sha256'),'hex') as usable from checked)
 select id,review_id,status,request_count,request_sha256,
 case when usable and ((status in('completed','reused') and ab is not null) or (request_count=1 and receipt_valid and outcome_status='completed')) then 'saved'
 when status='pending' and request_count=0 and not intent and wire is null then 'never_sent'
 when request_count=1 and receipt_valid and outcome_status='blocked' and not intent
  and outcome->>'request_sha256'=request_sha256 and outcome->>'provider_fetch_invoked'='false'
  and outcome->>'provider_response_received'='false' and outcome->>'raw_response_text' is null
  and outcome->>'error_code'='JLS_DATABASE_FAILED' then 'proven_not_sent'
 else 'uncertain' end,outcome,coalesce(ah,outcome_sha256),wire_sha256,
 case when status='pending' and request_count=0 then 'no_reservation_or_dispatch'
 when outcome->>'provider_fetch_invoked'='false' then 'immutable_worker_outcome_before_fetch_and_no_dispatch_intent'
 else 'immutable_exact_response_receipt' end from final
$$;
revoke all on function public.parallel_recovery_rows(uuid) from public,anon,authenticated;
grant execute on function public.parallel_recovery_rows(uuid) to service_role;

create or replace function public.continue_parallel_report_unattempted(p_source_run uuid) returns uuid
language plpgsql set search_path='' set jit='off' as $$
declare oldr public.analysis_jls_restaurant_runs;oldp public.analysis_jls_restaurant_protocols;oldpair public.analysis_parallel_reports;
 pair uuid;pid uuid;rid uuid;c jsonb;manifest jsonb;b jsonb;protocol_digest text;remaining int;acquired int;key text;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('parallel-unattempted:'||p_source_run,0));
 select * into oldr from public.analysis_jls_restaurant_runs where id=p_source_run for share;
 select * into oldp from public.analysis_jls_restaurant_protocols where id=oldr.protocol_id;
 select * into oldpair from public.analysis_parallel_reports where run_id=oldr.id;
 key='jls-direct4-parallel-no-luna-v1:continuation:'||p_source_run;
 select id into pair from public.analysis_parallel_reports where organization_id=oldr.organization_id and reference_report_id=oldpair.reference_report_id
  and reference_generation_id=oldpair.reference_generation_id and language=oldpair.language and configuration_version=key;
 if pair is not null then return pair;end if;
 if oldr.id is null or oldpair.id is null or oldr.status<>'blocked' or oldr.error_code<>'JLS_DATABASE_FAILED' or oldr.stage<>'jev'
 or oldr.expires_at<=now() or oldr.worker is not null or oldr.lease_until is not null
 or oldp.body->>'version' is distinct from 'jls-direct4-parallel-no-luna-v1'
 or oldr.consent->>'consent_source' is distinct from 'user_directive_codex_delegation'
 or oldr.consent_sha256<>public.jls_restaurant_hash(oldr.consent) or oldr.consent->>'protocol_sha256' is distinct from oldp.sha256
 or oldr.organization_id<>oldp.organization_id or oldpair.organization_id<>oldp.organization_id or oldpair.establishment_id<>oldp.establishment_id
 or not exists(select 1 from public.organization_members where organization_id=oldr.organization_id and user_id=oldp.authority_user_id and role in('owner','admin','manager'))
 or not exists(select 1 from public.historical_establishment_reports h where h.id=oldpair.reference_report_id and to_jsonb(h)=oldpair.source_report)
 or exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=oldr.id and phase<>'jev')
 or exists(select 1 from public.analysis_jls_sol_ready_operations where run_id=oldr.id)
 then raise exception 'PARALLEL_CONTINUATION_NOT_SAFE';end if;
 perform 1 from public.analysis_jls_restaurant_tasks where run_id=oldr.id order by id for share;
 if exists(select 1 from public.parallel_recovery_rows(oldr.id) where disposition='uncertain') then raise exception 'PARALLEL_CONTINUATION_OUTCOME_UNCERTAIN';end if;
 select count(*) filter(where disposition<>'saved'),count(*) filter(where disposition='saved'),
  jsonb_agg(to_jsonb(q)-'body' order by q.review_id) into remaining,acquired,manifest from public.parallel_recovery_rows(oldr.id) q;
 if remaining<=0 or remaining+acquired<>(oldp.body->>'max_jev_calls')::int then raise exception 'PARALLEL_CONTINUATION_RECEIPTS_CHANGED';end if;
 b=oldp.body||jsonb_build_object('operational_continuation',jsonb_build_object('source_run_id',oldr.id,'source_protocol_id',oldp.id,'source_protocol_sha256',oldp.sha256,
  'source_manifest',manifest,'source_manifest_sha256',public.jls_restaurant_hash(manifest),'max_new_jev_calls',remaining,'proof_version','parallel-saved-receipt-disposition-v1'));
 protocol_digest=public.jls_restaurant_hash(b);
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256)
 values(oldp.organization_id,oldp.establishment_id,oldp.authority_user_id,b,protocol_digest) returning id into pid;
 perform public.certify_parallel_report_runtime(pid);
 c=oldr.consent||jsonb_build_object('protocol_id',pid,'protocol_sha256',protocol_digest,'continuation',jsonb_build_object('source_run_id',oldr.id,'source_protocol_id',oldp.id,
  'source_run_sha256',public.jls_restaurant_hash(to_jsonb(oldr)),'source_manifest_sha256',public.jls_restaurant_hash(manifest),
  'max_new_jev_calls',remaining,'reused_results',acquired,'created_at',now(),'grant_expiry_unchanged',true));
 insert into public.analysis_jls_restaurant_runs(protocol_id,organization_id,consent,consent_sha256,expires_at)
 values(pid,oldr.organization_id,c,public.jls_restaurant_hash(c),oldr.expires_at) returning id into rid;
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256,identity,status,completed_at)
 select rid,t.organization_id,'jev',t.task_key,t.review_id,t.request,t.request_sha256,t.identity,case when q.disposition='saved' then 'reused' else 'pending' end,
 case when q.disposition='saved' then now() else null end from public.analysis_jls_restaurant_tasks t join public.parallel_recovery_rows(oldr.id) q on q.task_id=t.id where t.run_id=oldr.id;
 insert into public.analysis_jls_restaurant_artifacts(run_id,organization_id,kind,body,sha256)
 select rid,t.organization_id,'task:'||t.id,q.body,q.body_sha256 from public.analysis_jls_restaurant_tasks t
 join public.parallel_recovery_rows(oldr.id) q on q.review_id=t.review_id where t.run_id=rid and t.status='reused';
 insert into public.analysis_parallel_reports(organization_id,establishment_id,reference_report_id,reference_generation_id,language,configuration_version,protocol_id,run_id,corpus_sha256,source_report,source_reviews)
 values(oldpair.organization_id,oldpair.establishment_id,oldpair.reference_report_id,oldpair.reference_generation_id,oldpair.language,key,pid,rid,oldpair.corpus_sha256,oldpair.source_report,oldpair.source_reviews) returning id into pair;
 if not public.jls_restaurant_valid(rid) then raise exception 'PARALLEL_CONTINUATION_AUTHORIZATION_INVALID';end if;return pair;
end $$;
