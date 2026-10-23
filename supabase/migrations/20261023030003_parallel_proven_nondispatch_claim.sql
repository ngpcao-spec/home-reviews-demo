-- A reservation alone is not a send. Admit ONLY an exact, immutable server
-- outcome proving fetch was never invoked, bound to the certified continuation.
do $$declare d text;anchor text;begin
 d=pg_get_functiondef('public.claim_parallel_report_task(uuid,text)'::regprocedure);
 anchor='and not public.is_jls_sql_qualification(oldr.id)) then raise exception ''PARALLEL_PREVIOUS_OUTCOME_UNCERTAIN''';
 if position(anchor in d)=0 then raise exception 'PARALLEL_NONDISPATCH_GUARD_ANCHOR_CHANGED';end if;
 execute replace(d,anchor,$patch$and not public.is_jls_sql_qualification(oldr.id)
 and not exists(
  select 1 from jsonb_array_elements(p.body#>'{operational_continuation,source_manifest}') proof
  join public.analysis_jls_task_receipts receipt on receipt.task_id=oldt.id
  join public.analysis_jls_source_certificates certified on certified.protocol_id=p.id and certified.protocol_sha256=p.sha256
  where p.body#>>'{operational_continuation,source_run_id}'=oldr.id::text
   and proof->>'task_id'=oldt.id::text and proof->>'review_id'=oldt.review_id::text
   and proof->>'source_status'=oldt.status and proof->>'request_count'=oldt.request_count::text
   and proof->>'request_sha256'=oldt.request_sha256 and proof->>'disposition'='proven_not_sent'
   and proof->>'receipt_wire_sha256'=receipt.wire_sha256 and proof->>'body_sha256'=receipt.outcome_sha256
   and receipt.outcome_status='blocked' and receipt.request_sha256=oldt.request_sha256
   and receipt.wire::jsonb#>>'{body,provider_fetch_invoked}'='false'
   and receipt.wire::jsonb#>>'{body,provider_response_received}'='false'
   and receipt.wire::jsonb#>>'{body,raw_response_text}' is null
   and not exists(select 1 from public.analysis_jls_task_dispatch_intents sent where sent.task_id=oldt.id)
 )) then raise exception 'PARALLEL_PREVIOUS_OUTCOME_UNCERTAIN'$patch$);
end $$;
