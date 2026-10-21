do $$declare d text;begin
 select pg_get_functiondef('public.start_parallel_report(jsonb,text,uuid)'::regprocedure) into d;
 d=replace(d,'jsonb_array_elements(p_body->''pending'') v where v->>''review_id''=t.review_id::text and v->''identity''->>''analysis_text_sha256''=t.identity->>''analysis_text_sha256''',
 'jsonb_array_elements(p_body->''pending'') seed_entry(value) where seed_entry.value->>''review_id''=t.review_id::text and seed_entry.value->''identity''->>''analysis_text_sha256''=t.identity->>''analysis_text_sha256''');
 execute d;
end $$;
