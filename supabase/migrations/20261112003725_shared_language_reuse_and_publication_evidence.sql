-- Additive pilot correction. No backfill, provider request, activation or retry.
-- Original migrations and production publication rows remain untouched.
create function pg_temp.shared_patch(signature text, old_text text, new_text text) returns void
language plpgsql as $$declare d text;begin
 d:=pg_get_functiondef(signature::regprocedure);
 if strpos(d,old_text)=0 then raise exception 'SHARED_PATCH_ANCHOR_MISSING: %',signature;end if;
 execute replace(d,old_text,new_text);
end $$;

-- A completed collection in the requested language is reusable even when Google
-- returned no translation for some items. Another language is reusable only if
-- its saved provider translations/original language cover every readable item.
-- Otherwise return to the real initial worker, whose reservation is per language.
select pg_temp.shared_patch('public.join_available_shared_restaurant(uuid,uuid,text,text,text,jsonb)',
 'order by x.last_sync_at desc nulls last,x.id limit 1;',
 'order by (x.collection_language=p_language) desc,x.last_sync_at desc nulls last,x.id limit 1;');
select pg_temp.shared_patch('public.join_available_shared_restaurant(uuid,uuid,text,text,text,jsonb)',
 'perform public.capture_shared_review_corpus(source.id);',
 $new$perform public.capture_shared_review_corpus(source.id);
 if source.collection_language<>p_language and exists(
  select 1 from private.shared_restaurant_reviews r where r.restaurant_id=restaurant
   and public.review_usable_text(r.original_text,r.public_payload->>'text') is not null
   and lower(split_part(replace(coalesce(r.public_payload->>'original_language',''),'_','-'),'-',1))<>p_language
   and not exists(select 1 from private.shared_restaurant_review_translations t
    where t.restaurant_id=r.restaurant_id and t.external_id=r.external_id and t.language=p_language
     and t.original_text_sha256=encode(sha256(convert_to(r.original_text,'UTF8')),'hex')
     and nullif(btrim(t.translated_text),'') is not null)
 ) then return null;end if;$new$);
select pg_temp.shared_patch('public.join_available_shared_restaurant(uuid,uuid,text,text,text,jsonb)',
 'select count(*) into n from public.reviews where establishment_id=e.id;',
 $new$-- Reusing saved language data initializes that language's normal cadence.
 update private.shared_restaurant_collections set
  initialized_at=coalesce(initialized_at,source.last_sync_at),
  last_success_at=coalesce(last_success_at,source.last_sync_at)
 where restaurant_id=restaurant and language=e.collection_language;
 select count(*) into n from public.reviews where establishment_id=e.id;$new$);
select pg_temp.shared_patch('public.join_available_shared_restaurant(uuid,uuid,text,text,text,jsonb)',
 'next_sync_at=now(),last_review_id=head.external_review_id,last_review_at=head.published_at,',
 $new$next_sync_at=(select c.last_success_at+make_interval(hours=>min(o.monitoring_interval_hours)::integer)
   from private.shared_restaurant_collections c
   join private.shared_restaurant_subscriptions s on s.restaurant_id=c.restaurant_id and s.language=c.language
   join public.organizations o on o.id=s.organization_id
   where c.restaurant_id=restaurant and c.language=e.collection_language group by c.last_success_at),
  last_review_id=head.external_review_id,last_review_at=head.published_at,$new$);

-- Disseminating an original review does not advance the other language's
-- provider checkpoint. Its next run must still retrieve that review's translation.
select pg_temp.shared_patch('public.commit_incremental_review_sync(uuid,text,jsonb,jsonb)',
 $old$last_review_id=answer->>'head_id',last_review_at=(answer->>'head_at')::timestamptz,$old$,
 $new$last_review_id=case when collection_language=j.collection_language then answer->>'head_id' else last_review_id end,
   last_review_at=case when collection_language=j.collection_language then (answer->>'head_at')::timestamptz else last_review_at end,$new$);

-- Persist the publication's own immutable reference arrays, even when retention
-- already removed the disposable parallel analysis. Never reconstruct quotations.
select pg_temp.shared_patch('public.archive_shared_restaurant_reports(uuid)',
 'select report_id,language,generated_at,document,scope,source_bindings from public.current_report_publications',
 'select report_id,language,generated_at,document,scope,source_bindings,evidence_bindings,stale,stale_reason,provenance from public.current_report_publications');
select pg_temp.shared_patch('public.archive_shared_restaurant_reports(uuid)',
 $old$jsonb_build_object('review_count',jsonb_array_length(a.source_reviews),'stale',true),'[]'::jsonb$old$,
 $new$jsonb_build_object('review_count',jsonb_array_length(a.source_reviews),'stale',true),'[]'::jsonb,'[]'::jsonb,true,'SHARED_DATED_PUBLICATION'::text,'{}'::jsonb$new$);
select pg_temp.shared_patch('public.archive_shared_restaurant_reports(uuid)',
 $old$'source_bindings',p.source_bindings,$old$,
 $new$'source_bindings',p.source_bindings,'evidence_bindings',p.evidence_bindings,
     'publication_stale',p.stale,'publication_stale_reason',p.stale_reason,'publication_provenance',p.provenance,$new$);
-- Existing incomplete archives can be enriched, never overwrite their content,
-- date, language or previously frozen source text with an empty later value.
select pg_temp.shared_patch('public.archive_shared_restaurant_reports(uuid)',
 'on conflict(restaurant_id,report_id) do nothing;',
 $new$on conflict(restaurant_id,report_id) do update set evidence=
    shared_restaurant_report_versions.evidence || jsonb_build_object(
     'source_bindings',excluded.evidence->'source_bindings',
     'evidence_bindings',excluded.evidence->'evidence_bindings',
     'publication_stale',excluded.evidence->'publication_stale',
     'publication_stale_reason',excluded.evidence->'publication_stale_reason',
     'publication_provenance',excluded.evidence->'publication_provenance')
   where shared_restaurant_report_versions.document=excluded.document
    and shared_restaurant_report_versions.language=excluded.language
    and shared_restaurant_report_versions.generated_at=excluded.generated_at
    and (not (shared_restaurant_report_versions.evidence ? 'evidence_bindings')
      or shared_restaurant_report_versions.evidence->'evidence_bindings'=excluded.evidence->'evidence_bindings');$new$);

do $$declare f text;begin foreach f in array array[
 'public.read_shared_report_publication(uuid,text,uuid)',
 'public.read_shared_report_version(uuid,text,uuid,uuid)'] loop
 perform pg_temp.shared_patch(f,
  $old$'stale_reason','SHARED_DATED_PUBLICATION'$old$,
  $new$'stale_reason',coalesce(v.evidence->>'publication_stale_reason','SHARED_DATED_PUBLICATION'),
   'publication_stale',v.evidence->'publication_stale'$new$);
 perform pg_temp.shared_patch(f,
  $old$'source_reviews',v.evidence->'source_reviews',$old$,
  $new$'source_reviews',v.evidence->'source_reviews',
    'source_bindings',coalesce(v.evidence->'source_bindings','[]'::jsonb),
    'evidence_bindings',coalesce(v.evidence->'evidence_bindings','[]'::jsonb),$new$);
 perform pg_temp.shared_patch(f,
  $old$v.document->'controls'||jsonb_build_object('evidence',v.evidence->'evidence',$old$,
  $new$coalesce(v.document->'controls','{}'::jsonb)||jsonb_build_object('evidence',
     case when jsonb_array_length(coalesce(v.evidence->'evidence','[]'::jsonb))>0 then v.evidence->'evidence'
       else coalesce(v.evidence->'evidence_bindings','[]'::jsonb) end,$new$);
end loop;end $$;

-- Same existing trigger, now also captures provenance-only publication updates.
drop trigger shared_report_archive on public.current_report_publications;
create trigger shared_report_archive after insert or update of document,source_bindings,evidence_bindings,stale,stale_reason
 on public.current_report_publications for each row execute function private.capture_shared_report_archive();
