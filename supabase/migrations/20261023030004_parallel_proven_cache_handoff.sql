create function public.parallel_proven_nondispatch(p_protocol uuid,p_old_task uuid) returns boolean
language sql stable set search_path='' set jit='off' as $$
 select current_user='service_role' and exists(
  select 1 from public.analysis_jls_restaurant_protocols p
  join public.analysis_jls_source_certificates certified on certified.protocol_id=p.id and certified.protocol_sha256=p.sha256
  cross join lateral jsonb_array_elements(p.body#>'{operational_continuation,source_manifest}') proof
  join public.analysis_jls_restaurant_tasks oldt on oldt.id=p_old_task
  join public.analysis_jls_task_receipts receipt on receipt.task_id=oldt.id
  where p.id=p_protocol and p.organization_id=oldt.organization_id
   and p.body#>>'{operational_continuation,source_run_id}'=oldt.run_id::text
   and proof->>'task_id'=oldt.id::text and proof->>'review_id'=oldt.review_id::text
   and proof->>'source_status'=oldt.status and proof->>'request_count'=oldt.request_count::text
   and proof->>'request_sha256'=oldt.request_sha256 and proof->>'disposition'='proven_not_sent'
   and proof->>'receipt_wire_sha256'=receipt.wire_sha256 and proof->>'body_sha256'=receipt.outcome_sha256
   and receipt.outcome_status='blocked' and receipt.request_sha256=oldt.request_sha256
   and receipt.wire::jsonb#>>'{body,provider_fetch_invoked}'='false'
   and receipt.wire::jsonb#>>'{body,provider_response_received}'='false'
   and receipt.wire::jsonb#>>'{body,raw_response_text}' is null
   and not exists(select 1 from public.analysis_jls_task_dispatch_intents sent where sent.task_id=oldt.id)
 );
$$;
revoke all on function public.parallel_proven_nondispatch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.parallel_proven_nondispatch(uuid,uuid) to service_role;
do $$declare d text;anchor text;begin
 d=pg_get_functiondef('public.claim_parallel_report_task(uuid,text)'::regprocedure);
 anchor='c public.analysis_parallel_jev_cache;begin';
 if position(anchor in d)=0 then raise exception 'PARALLEL_CACHE_HANDOFF_DECLARATION_CHANGED';end if;
 d=replace(d,anchor,'c public.analysis_parallel_jev_cache;handoff jsonb;begin');
 anchor='if c.task_id<>t.id or c.status<>''reserved'' then raise exception ''PARALLEL_PREVIOUS_OUTCOME_UNCERTAIN'';end if;';
 if position(anchor in d)=0 then raise exception 'PARALLEL_CACHE_HANDOFF_GUARD_CHANGED';end if;
 execute replace(d,anchor,$patch$if c.task_id<>t.id or c.status<>'reserved' then
    if c.status not in('reserved','uncertain') or not public.parallel_proven_nondispatch(p.id,c.task_id) then raise exception 'PARALLEL_PREVIOUS_OUTCOME_UNCERTAIN';end if;
    handoff=jsonb_build_object('version','parallel-proven-nondispatch-cache-handoff-v1','previous_cache',to_jsonb(c),'new_task_id',t.id,
     'new_run_id',r.id,'protocol_sha256',p.sha256,'reason','first_provider_send_after_immutable_non_dispatch_proof','source_history_unchanged',true);
    perform public.save_jls_snapshot_preparation(p.id,'cache_handoff_'||t.id,handoff,public.jls_restaurant_hash(handoff));
    update public.analysis_parallel_jev_cache set task_id=t.id,status='reserved',body=null,sha256=null where organization_id=c.organization_id and establishment_id=c.establishment_id and review_id=c.review_id and analysis_text_sha256=c.analysis_text_sha256 and configuration_sha256=c.configuration_sha256 and model=c.model and task_id=c.task_id;
   end if;$patch$);
end $$;
