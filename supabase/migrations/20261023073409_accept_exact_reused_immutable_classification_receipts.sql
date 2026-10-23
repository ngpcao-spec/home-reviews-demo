-- A reused task can carry a real immutable supplier receipt recovered earlier.
-- Accept it only with identical identity/request, real response telemetry, served
-- model and integrity; never accept a technical mock or retry an unknown send.
do $$declare d text;a text;begin
 d=pg_get_functiondef('public.claim_parallel_report_task(uuid,text)'::regprocedure);
 a='and oldt.review_id=t.review_id and oldt.phase=''jev'' and oldt.status=''completed''';
 if position(a in d)=0 then raise exception 'COMPLETED_RECEIPT_SCOPE_CHANGED';end if;
 execute replace(d,a,'and oldt.review_id=t.review_id and oldt.phase=''jev'' and oldt.status in(''completed'',''reused'') and a.body->>''provider_fetch_invoked''=''true'' and a.body->>''provider_response_received''=''true'' and coalesce(a.body->>''explicit_technical_mock'',''false'')<>''true''');
end $$;
