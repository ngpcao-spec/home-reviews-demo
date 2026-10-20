-- Build the already uniqueness-checked review lookup once, rather than scanning
-- the complete JSON dataset again for each of the 87 source task bindings.
do $$declare d text;before text;after text;begin
 d=pg_get_functiondef('public.bind_jls_direct4_historical_evidence(uuid,jsonb,text)'::regprocedure);
 before='rowdata jsonb;expected text;begin';after='rowdata jsonb;expected text;dataset_by_review jsonb;begin';
 if position(before in d)=0 then raise exception 'DATASET_LOOKUP_DECLARATION_NOT_FOUND';end if;d=replace(d,before,after);
 before='for v in select value from jsonb_array_elements(p_body->''jev_source_tasks'') loop';
 after='select jsonb_object_agg(value->>''review_id'',value) into dataset_by_review from jsonb_array_elements(p_body->''dataset''->''body''->''reviews''); '||before;
 if position(before in d)=0 then raise exception 'DATASET_LOOKUP_LOOP_NOT_FOUND';end if;d=replace(d,before,after);
 before='and exists(select 1 from jsonb_array_elements(p_body->''dataset''->''body''->''reviews'') d where d->>''review_id''=t.review_id::text'||chr(10)||
 ' and d->''result''=a.body->''direct4_result'' and d->>''raw_response_text''=a.body->>''raw_response_text''))';
 after='and dataset_by_review ? t.review_id::text and dataset_by_review->(t.review_id::text)->''result''=a.body->''direct4_result'' and dataset_by_review->(t.review_id::text)->>''raw_response_text''=a.body->>''raw_response_text'')';
 if position(before in d)=0 then raise exception 'DATASET_LOOKUP_BINDING_NOT_FOUND';end if;execute replace(d,before,after);
end $$;
