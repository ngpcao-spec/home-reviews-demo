-- A textless duplicate cannot displace the usable text of the same review.
-- Its earliest publication date still governs the entire duplicate group.
do $$declare d text;a text;begin
 d=pg_get_functiondef('public.ingest_recent_reviews(uuid,uuid,jsonb,text)'::regprocedure);
 a='partition by btrim(value#>>''{row,external_review_id}'') order by ordinality desc';
 if position(a in d)=0 then raise exception 'RETENTION_INGEST_DEDUP_CHANGED';end if;
 d=replace(d,a,'partition by btrim(value#>>''{row,external_review_id}'') order by (public.review_usable_text(value#>>''{row,original_text}'',value#>>''{row,text}'') is not null) desc,ordinality desc');execute d;
end $$;
