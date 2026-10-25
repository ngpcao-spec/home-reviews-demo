-- Stored function definitions may use CRLF. Remove the retired source branch
-- without depending on line endings, keeping exact source-hash validation.
do $$declare d text;begin
 d=pg_get_functiondef('public.read_current_report_publication(uuid,text)'::regprocedure);
 d=regexp_replace(d,'\s+union all\s+select corrected_english_text from public\.analysis_review_english_translation_overrides where review_id=r\.id','','g');
 if position('corrected_english_text' in d)>0 then raise exception 'PUBLICATION_SOURCE_DEFINITION_CHANGED';end if;
 execute d;
end$$;
