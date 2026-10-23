-- Materialize frozen arrays/configuration once for strict cache reuse. This
-- avoids decompressing an entire large protocol once for each saved receipt.
do $$declare d text;a text;b text;begin
 d=pg_get_functiondef('public.start_parallel_report_internal(jsonb,text,uuid,jsonb)'::regprocedure);
 a=' insert into public.analysis_parallel_jev_cache(organization_id';
 b=' with eligible_protocols as materialized(select id,establishment_id from public.analysis_jls_restaurant_protocols where organization_id=cur.organization_id and establishment_id=cur.establishment_id and body->>''classification_configuration_sha256''=p_body->>''classification_configuration_sha256''),requested_texts as materialized(select value->>''review_id'' as review_id,value#>>''{identity,analysis_text_sha256}'' as text_sha from jsonb_array_elements(p_body->''pending''))
 insert into public.analysis_parallel_jev_cache(organization_id';
 if position(a in d)=0 then raise exception 'CURRENT_CACHE_INSERT_CHANGED';end if;d=replace(d,a,b);
 a='join public.analysis_jls_restaurant_protocols oldp on oldp.id=oldr.protocol_id';
 if position(a in d)=0 then raise exception 'CURRENT_CACHE_PROTOCOL_CHANGED';end if;
 d=replace(d,a,'join eligible_protocols oldp on oldp.id=oldr.protocol_id join requested_texts wanted on wanted.review_id=t.review_id::text and wanted.text_sha=t.identity->>''analysis_text_sha256''');
 a='and oldp.body->>''classification_configuration_sha256''=p_body->>''classification_configuration_sha256'' and';
 if position(a in d)=0 then raise exception 'CURRENT_CACHE_CONFIGURATION_CHANGED';end if;d=replace(d,a,'and');
 a='and exists(select 1 from jsonb_array_elements(p_body->''pending'') seed_entry(value) where seed_entry.value->>''review_id''=t.review_id::text and seed_entry.value->''identity''->>''analysis_text_sha256''=t.identity->>''analysis_text_sha256'')';
 if position(a in d)=0 then raise exception 'CURRENT_CACHE_TEXT_CHANGED';end if;d=replace(d,a,'');execute d;
end $$;
