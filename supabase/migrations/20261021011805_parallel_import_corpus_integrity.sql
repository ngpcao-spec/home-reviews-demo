do $$declare d text;begin
 select pg_get_functiondef('public.import_parallel_derivative(jsonb,text)'::regprocedure) into d;
 d=replace(d,'if src.sha256 is distinct from p_body->>''source_archive_sha256''',
 'if cur.generation_id::text is distinct from p_body->>''reference_generation_id'' or src.sha256 is distinct from p_body->>''source_archive_sha256''');
 d=replace(d,'or e->''rating'' is distinct from r->''rating'' then raise exception ''DERIVATIVE_CORPUS_CHANGED'';',
 'or e->''rating'' is distinct from r->''rating'' or e->''review_detailed_rating'' is distinct from r->''review_detailed_rating'' or e->''review_context'' is distinct from r->''review_context'' or e->''published_at'' is distinct from r->''published_at'' or e->''analysis_language'' is distinct from r->''analysis_language'' or e->''analysis_source'' is distinct from r->''analysis_source'' then raise exception ''DERIVATIVE_CORPUS_CHANGED'';');
 execute d;
end $$;
