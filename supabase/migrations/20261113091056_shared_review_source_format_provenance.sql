-- Only documented line-break representations are equivalent. No trimming,
-- translation, Unicode folding, punctuation removal or semantic matching.
create function private.shared_source_format(text) returns text
language sql immutable strict set search_path='' as $$
 select replace(regexp_replace($1,'<br[[:space:]]*/?[[:space:]]*>',E'\n','gi'),E'\r\n',E'\n');
$$;
create table private.shared_review_source_versions(
 restaurant_id uuid not null references private.shared_restaurants(id),
 external_id text not null,
 source_sha256 text not null,
 source_text text not null,
 provenance jsonb not null,
 primary key(restaurant_id,external_id,source_sha256),
 check(source_sha256=encode(sha256(convert_to(source_text,'UTF8')),'hex'))
);
alter table private.shared_review_source_versions enable row level security;
revoke all on private.shared_review_source_versions from public,anon,authenticated;

-- Archives stay keyed by the EXACT source bytes. Equivalence is checked from
-- stored source text at read time; never rewrite an archived translation hash.
create function private.shared_compatible_translations(p_restaurant uuid,p_external text,p_source text)
returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('language',q.language,'translated_text',q.translated_text) order by q.language),'[]')
 from (select distinct on(t.language) t.language,t.translated_text
 from private.shared_restaurant_review_translations t
 left join private.shared_review_source_versions s on s.restaurant_id=t.restaurant_id
  and s.external_id=t.external_id and s.source_sha256=t.original_text_sha256
 where t.restaurant_id=p_restaurant and t.external_id=p_external and (
  t.original_text_sha256=encode(sha256(convert_to(p_source,'UTF8')),'hex')
  or private.shared_source_format(s.source_text)=private.shared_source_format(p_source))
 order by t.language,(t.original_text_sha256=encode(sha256(convert_to(p_source,'UTF8')),'hex')) desc,t.original_text_sha256) q;
$$;

create function pg_temp.patch_source_format(signature text,old_text text,new_text text) returns void
language plpgsql as $$declare d text;begin
 d:=pg_get_functiondef(signature::regprocedure);
 if strpos(d,old_text)=0 then raise exception 'SOURCE_FORMAT_PATCH_ANCHOR_MISSING: %',signature;end if;
 execute replace(d,old_text,new_text);
end $$;

select pg_temp.patch_source_format('public.capture_shared_review_corpus_without_archive(uuid)',
 $old$insert into private.shared_restaurant_reviews(restaurant_id,external_id,published_at,rating,original_text,public_payload)$old$,
 $new$insert into private.shared_review_source_versions(restaurant_id,external_id,source_sha256,source_text,provenance)
 select restaurant,r.external_review_id,encode(sha256(convert_to(coalesce(nullif(r.original_text,''),r.text,''),'UTF8')),'hex'),
  coalesce(nullif(r.original_text,''),r.text,''),jsonb_build_object('kind','persisted-provider-original','establishment_id',r.establishment_id,'review_id',r.id)
 from public.reviews r where r.establishment_id=p_establishment
 on conflict do nothing;
 insert into private.shared_restaurant_reviews(restaurant_id,external_id,published_at,rating,original_text,public_payload)$new$);

-- A later language observation may update metadata, but mere formatting must
-- not churn the existing source or invalidate its analyses and translations.
select pg_temp.patch_source_format('public.capture_shared_review_corpus_without_archive(uuid)',
 $old$published_at=excluded.published_at,rating=excluded.rating,original_text=excluded.original_text,
   public_payload=excluded.public_payload$old$,
 $new$published_at=excluded.published_at,rating=excluded.rating,
 original_text=case when private.shared_source_format(excluded.original_text)=private.shared_source_format(shared_restaurant_reviews.original_text)
  then shared_restaurant_reviews.original_text else excluded.original_text end,
 public_payload=case when private.shared_source_format(excluded.original_text)=private.shared_source_format(shared_restaurant_reviews.original_text)
  then excluded.public_payload||jsonb_build_object('original_text',shared_restaurant_reviews.original_text,'text',shared_restaurant_reviews.original_text)
  else excluded.public_payload end$new$);

select pg_temp.patch_source_format('public.shared_review_projection_bundle(uuid,boolean)',
 $old$coalesce((select jsonb_agg(jsonb_build_object('language',t.language,'translated_text',t.translated_text))
    from private.shared_restaurant_review_translations t where t.restaurant_id=v.restaurant_id and t.external_id=v.external_id
      and t.original_text_sha256=encode(sha256(convert_to(v.original_text,'UTF8')),'hex')),'[]')$old$,
 $new$private.shared_compatible_translations(v.restaurant_id,v.external_id,v.original_text)$new$);

revoke all on function private.shared_source_format(text),private.shared_compatible_translations(uuid,text,text) from public,anon,authenticated;
-- No data backfill or activation here. Historical variants must be loaded only
-- from verified saved provider originals in a separately guarded repair.
