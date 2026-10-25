-- Invisible/blank-only comments remain rating-only rows in a frozen corpus.
-- Preserve every actual comment byte-for-byte; this changes no JEV prompt.
do $$declare d text;a text;begin
 d=pg_get_functiondef('public.freeze_recent_review_source(uuid,uuid,text,timestamptz)'::regprocedure);
 a=$needle$'original_text',coalesce(nullif(r.original_text,''),r.text)$needle$;
 if position(a in d)=0 then raise exception 'FROZEN_TEXT_ADMISSION_CHANGED';end if;
 d=replace(d,a,$replacement$'original_text',case when public.review_usable_text(r.original_text,r.text) is null then null else coalesce(nullif(r.original_text,''),r.text) end$replacement$);
 a=$needle$'text',r.text,'published_at'$needle$;
 if position(a in d)=0 then raise exception 'FROZEN_TEXT_FIELD_CHANGED';end if;
 d=replace(d,a,$replacement$'text',case when public.review_usable_text(r.original_text,r.text) is null then null else r.text end,'published_at'$replacement$);
 execute d;
end $$;
