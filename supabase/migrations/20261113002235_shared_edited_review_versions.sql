-- Additive fix; no activation, provider call, checkpoint movement or data backfill.
-- Google can return an edited review under the same ID with a later date.
create function pg_temp.patch_edited_review(signature text, old_text text, new_text text) returns void
language plpgsql as $$declare d text;begin
 d:=pg_get_functiondef(signature::regprocedure);
 if strpos(d,old_text)=0 then raise exception 'EDITED_REVIEW_PATCH_ANCHOR_MISSING: %',signature;end if;
 execute replace(d,old_text,new_text);
end $$;

-- A completed language collection is proven by its own persisted ID/date pair.
-- Another language may already have a newer version of that same shared ID.
select pg_temp.patch_edited_review('public.seed_verified_shared_restaurant(uuid,text,uuid)',
 $old$and exists(select 1 from private.shared_restaurant_reviews
      where restaurant_id=restaurant and external_id=e.last_review_id and published_at=e.last_review_at)$old$,
 $new$and exists(select 1 from public.reviews
      where establishment_id=e.id and organization_id=e.organization_id
       and external_review_id=e.last_review_id and published_at=e.last_review_at)$new$);

-- Keep date, content and public payload from the same version. A later fetch of
-- an older version must not undo an edit already obtained in another language.
-- Equal dates use the provider observation time; legacy null timestamps remain valid.
select pg_temp.patch_edited_review('public.capture_shared_review_corpus_without_archive(uuid)',
 $old$on conflict(restaurant_id,external_id) do update set rating=excluded.rating,original_text=excluded.original_text,
   public_payload=excluded.public_payload;$old$,
 $new$on conflict(restaurant_id,external_id) do update set
   published_at=excluded.published_at,rating=excluded.rating,original_text=excluded.original_text,
   public_payload=excluded.public_payload
 where excluded.published_at>shared_restaurant_reviews.published_at
    or (excluded.published_at=shared_restaurant_reviews.published_at
      and coalesce((excluded.public_payload->>'provider_scraped_at')::timestamptz,'-infinity'::timestamptz)
       >=coalesce((shared_restaurant_reviews.public_payload->>'provider_scraped_at')::timestamptz,'-infinity'::timestamptz));$new$);

-- The lower-level collection API obeys the same monotonic date rule.
select pg_temp.patch_edited_review('public.complete_shared_restaurant_collection(uuid,jsonb)',
 $old$on conflict(restaurant_id,external_id) do nothing;$old$,
 $new$on conflict(restaurant_id,external_id) do update set
   published_at=excluded.published_at,rating=excluded.rating,original_text=excluded.original_text,
   public_payload=case when shared_restaurant_reviews.public_payload is null then null else
    shared_restaurant_reviews.public_payload || jsonb_build_object(
     'published_at',excluded.published_at,'rating',excluded.rating,'original_text',excluded.original_text,
     'text',excluded.original_text) end
 where excluded.published_at>shared_restaurant_reviews.published_at;$new$);

