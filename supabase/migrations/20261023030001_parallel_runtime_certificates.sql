-- Reuse the existing immutable runtime-certificate path. Reservation and
-- dispatch must not repeatedly extract the multi-megabyte protocol JSON.
create function public.certify_parallel_report_runtime(p_protocol uuid) returns text
language plpgsql set search_path='' set jit='off' as $$
declare p public.analysis_jls_restaurant_protocols;parent public.analysis_jls_restaurant_protocols;
 c public.analysis_jls_source_certificates;b jsonb;h text;prepared uuid;pair uuid;sid uuid;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol;
 if p.id is null or p.body->>'version' is distinct from 'jls-direct4-parallel-no-luna-v1' then raise exception 'PARALLEL_RUNTIME_SCOPE_INVALID';end if;
 select * into c from public.analysis_jls_source_certificates where protocol_id=p.id;
 if c.protocol_id is not null then
  if c.protocol_sha256 is distinct from p.sha256 or c.organization_id<>p.organization_id or c.establishment_id<>p.establishment_id or c.authority_user_id<>p.authority_user_id then raise exception 'PARALLEL_RUNTIME_CERTIFICATE_CHANGED';end if;
  return c.sha256;
 end if;
 if p.body?'operational_continuation' then
  select * into parent from public.analysis_jls_restaurant_protocols where id=(p.body#>>'{operational_continuation,source_protocol_id}')::uuid;
  sid=(p.body#>>'{operational_continuation,source_run_id}')::uuid;
  if parent.id is null or parent.created_at>=p.created_at or parent.sha256 is distinct from p.body#>>'{operational_continuation,source_protocol_sha256}'
   or (p.body-'operational_continuation') is distinct from (parent.body-'operational_continuation')
   or not exists(select 1 from public.analysis_jls_restaurant_runs where id=sid and protocol_id=parent.id and status='blocked')
   or p.sha256 is distinct from public.jls_restaurant_hash(p.body)
   or p.body#>>'{operational_continuation,source_manifest_sha256}' is distinct from public.jls_restaurant_hash(p.body#>'{operational_continuation,source_manifest}')
  then raise exception 'PARALLEL_RUNTIME_CONTINUATION_CHANGED';end if;
  perform public.certify_parallel_report_runtime(parent.id);
 else
  select id into prepared from public.analysis_parallel_launch_preparations where sha256=p.sha256 and body=p.body and authority_user_id=p.authority_user_id and organization_id=p.organization_id;
  if prepared is null then
   select id into pair from public.analysis_parallel_reports where protocol_id=p.id and organization_id=p.organization_id and establishment_id=p.establishment_id
    and source_reviews=p.body#>'{source_snapshot,reviews}' and source_report=p.body->'frozen_report';
   if pair is null or p.sha256 is distinct from public.jls_restaurant_hash(p.body) or not public.check_parallel_protocol(p.body) then raise exception 'PARALLEL_RUNTIME_SOURCE_UNCERTIFIED';end if;
  end if;
 end if;
 b=jsonb_build_object('version','parallel-runtime-certificate-v1','protocol_id',p.id,'protocol_sha256',p.sha256,'organization_id',p.organization_id,'establishment_id',p.establishment_id,
  'authority_user_id',p.authority_user_id,'preparation_id',prepared,'existing_pair_id',pair,'parent_protocol_id',parent.id,'source_snapshot_sha256',p.body->>'source_snapshot_sha256',
  'configuration_sha256',p.body->>'configuration_sha256','pending_sha256',p.body->>'pending_sha256');h=public.jls_restaurant_hash(b);
 insert into public.analysis_jls_source_certificates(protocol_id,organization_id,establishment_id,authority_user_id,protocol_sha256,body,sha256)
 values(p.id,p.organization_id,p.establishment_id,p.authority_user_id,p.sha256,b,h) on conflict(protocol_id) do nothing;
 insert into public.analysis_jls_source_certificate_refs values(p.id,'historical_report_runs',(p.body#>>'{reference,historical_run_id}')::uuid) on conflict do nothing;
 if sid is not null then
  insert into public.analysis_jls_source_certificate_refs values(p.id,'analysis_jls_restaurant_runs',sid) on conflict do nothing;
  insert into public.analysis_jls_source_certificate_refs select p.id,'analysis_jls_restaurant_tasks',id from public.analysis_jls_restaurant_tasks where run_id=sid on conflict do nothing;
 end if;return h;
end $$;
revoke all on function public.certify_parallel_report_runtime(uuid) from public,anon,authenticated;
grant execute on function public.certify_parallel_report_runtime(uuid) to service_role;

do $$declare d text;anchor text;begin
 d=pg_get_functiondef('public.start_parallel_report_internal(jsonb,text,uuid,jsonb)'::regprocedure);
 anchor=' -- Seed only exact';if position(anchor in d)=0 then raise exception 'PARALLEL_CERTIFICATE_START_ANCHOR_CHANGED';end if;
 execute replace(d,anchor,' perform public.certify_parallel_report_runtime(p);'||chr(10)||anchor);
 -- The existing non-spending qualification uses this same protocol and guard.
 d=pg_get_functiondef('public.certify_jls_direct4_sources(uuid)'::regprocedure);
 anchor='if p.id is null or p.body->>''version'' not in';
 if position(anchor in d)=0 then raise exception 'PARALLEL_QUALIFICATION_CERTIFIER_ANCHOR_CHANGED';end if;
 execute replace(d,anchor,'if p.body->>''version''=''jls-direct4-parallel-no-luna-v1'' then return public.certify_parallel_report_runtime(p.id);end if; '||anchor);
 d=pg_get_functiondef('public.start_jls_sql_qualification(uuid,text)'::regprocedure);
 anchor='(v->''payload'')||jsonb_build_object(''questions'',p.body#>''{configuration,jev_request_template,questions}'')';
 if position(anchor in d)=0 then raise exception 'PARALLEL_QUALIFICATION_REQUEST_ANCHOR_CHANGED';end if;
 execute replace(d,anchor,'case when p.body->>''version''=''jls-direct4-parallel-no-luna-v1'' then v->''payload'' else '||anchor||' end');
 d=pg_get_functiondef('public.claim_jls_restaurant_task(uuid,text)'::regprocedure);
 anchor='exists(select 1 from public.analysis_parallel_reports where run_id=p_run)';
 if position(anchor in d)=0 then raise exception 'PARALLEL_QUALIFICATION_ROUTE_ANCHOR_CHANGED';end if;
 execute replace(d,anchor,'('||anchor||' or exists(select 1 from public.analysis_jls_restaurant_runs rr join public.analysis_jls_source_certificates cc on cc.protocol_id=rr.protocol_id where rr.id=p_run and cc.body->>''version''=''parallel-runtime-certificate-v1''))');
 -- Technical fixtures never reserve, read, overwrite or poison the paid cache.
 d=pg_get_functiondef('public.claim_parallel_report_task(uuid,text)'::regprocedure);
 anchor='   if exists(select 1 from public.analysis_jls_restaurant_tasks oldt';
 if position(anchor in d)=0 then raise exception 'PARALLEL_QUALIFICATION_CACHE_ANCHOR_CHANGED';end if;
 d=replace(d,anchor,'   if not public.is_jls_sql_qualification(r.id) then'||chr(10)||anchor);
 anchor='  elsif not exists(select 1 from public.analysis_jls_sol_ready_artifacts';
 if position(anchor in d)=0 then raise exception 'PARALLEL_QUALIFICATION_CACHE_END_CHANGED';end if;
 execute replace(d,anchor,'  end if;'||chr(10)||anchor);
end $$;
