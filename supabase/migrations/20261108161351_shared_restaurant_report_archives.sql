-- Dated public report documents and frozen public evidence are independent of
-- the rolling review corpus. Private frozen drafts are deliberately excluded.
create function public.archive_shared_restaurant_reports(p_establishment uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare restaurant uuid; p record; source jsonb; evidence jsonb; n integer:=0;
begin
 restaurant:=public.shared_restaurant_for_establishment(p_establishment);
 if restaurant is null then return 0; end if;
 for p in
  select report_id,language,generated_at,document,scope,source_bindings from public.current_report_publications where establishment_id=p_establishment
  union all
  select a.id,a.language,a.generated_at,jsonb_build_object('id',a.id,'current_source_run_id',a.current_source_run_id,
   'created_at',a.created_at,'generated_at',a.generated_at,'configuration_version',a.configuration_version,'state','completed',
   'derived_report',private.publication_generated_report(a.derived_report),'statistics',a.statistics,'usage',a.usage,
   'source_reviews','[]'::jsonb,'controls',jsonb_build_object('technical_checks_passed',true,'dated_publication',true)),
   jsonb_build_object('review_count',jsonb_array_length(a.source_reviews),'stale',true),'[]'::jsonb
  from public.analysis_parallel_reports a where a.establishment_id=p_establishment and a.state='completed'
   and a.controls->>'technical_checks_passed'='true' and a.derived_report->'report' is not null and a.generated_at is not null
   and not exists(select 1 from public.current_report_publications c where c.report_id=a.id)
 loop
  select coalesce(jsonb_agg((select jsonb_object_agg(k,v) from jsonb_each(r) x(k,v) where k=any(array[
   'id','google_review_id','rating','published_at','original_text','original_language','analysis_text','analysis_text_sha256',
   'analysis_language','analysis_source','review_context','review_detailed_rating','translation_provenance']))),'[]') into source
  from public.analysis_parallel_reports a cross join lateral jsonb_array_elements(a.source_reviews) r
  where a.id=p.report_id and a.state='completed' and a.controls->>'technical_checks_passed'='true';
  select coalesce(jsonb_agg((select jsonb_object_agg(k,v) from jsonb_each(e) x(k,v) where k=any(array[
   'evidence_id','review_id','category','polarity','quote','quote_sha256']))),'[]') into evidence
  from public.analysis_parallel_reports a cross join lateral jsonb_array_elements(a.controls->'evidence') e
  where a.id=p.report_id and a.state='completed' and a.controls->>'technical_checks_passed'='true';
  insert into private.shared_restaurant_report_versions(restaurant_id,report_id,language,generated_at,document,evidence)
   values(restaurant,p.report_id,p.language,p.generated_at,p.document,
    jsonb_build_object('source_reviews',source,'evidence',evidence,'source_bindings',p.source_bindings,
     'scope',p.scope-'organization_id'-'establishment_id','source_available',jsonb_array_length(source)>0))
   on conflict(restaurant_id,report_id) do nothing;
  n:=n+1;
 end loop;
 return n;
end $$;

create function private.capture_shared_report_archive() returns trigger
language plpgsql security definer set search_path='' as $$begin
 perform public.archive_shared_restaurant_reports(new.establishment_id);return new;
end $$;
create trigger shared_report_archive after insert or update of document on public.current_report_publications
 for each row execute function private.capture_shared_report_archive();

create function public.read_shared_report_publication(p_establishment uuid,p_language text,p_user uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('scope',v.evidence->'scope'||jsonb_build_object('stale',true,'stale_reason','SHARED_DATED_PUBLICATION'),
  'row',v.document||jsonb_build_object('generated_at',v.generated_at,'source_reviews',v.evidence->'source_reviews',
    'controls',v.document->'controls'||jsonb_build_object('evidence',v.evidence->'evidence','dated_publication',true,
      'shared_publication',true,'source_available',v.evidence->'source_available')))
 from private.shared_restaurant_establishments l
 join public.establishments e on e.id=l.establishment_id and e.active
 join private.shared_restaurant_subscriptions s on s.restaurant_id=l.restaurant_id and s.organization_id=e.organization_id
 join private.shared_restaurant_report_versions v on v.restaurant_id=l.restaurant_id and v.language=p_language
 where e.id=p_establishment and public.shared_restaurant_runtime_enabled()
  and exists(select 1 from public.organization_members where organization_id=e.organization_id and user_id=p_user and role in ('owner','admin','manager'))
 order by v.generated_at desc,v.report_id limit 1;
$$;

-- Before any corpus rotation, archive the available current evidence. The
-- existing report retirement and manual-retry rules remain untouched.
alter function public.capture_shared_review_corpus(uuid) rename to capture_shared_review_corpus_without_archive;
create function public.capture_shared_review_corpus(p_establishment uuid) returns integer
language plpgsql security definer set search_path='' as $$begin
 perform public.archive_shared_restaurant_reports(p_establishment);
 return public.capture_shared_review_corpus_without_archive(p_establishment);
end $$;

revoke all on function public.archive_shared_restaurant_reports(uuid),public.read_shared_report_publication(uuid,text,uuid),
 public.capture_shared_review_corpus(uuid),private.capture_shared_report_archive() from public,anon,authenticated;
grant execute on function public.archive_shared_restaurant_reports(uuid),public.read_shared_report_publication(uuid,text,uuid),
 public.capture_shared_review_corpus(uuid) to service_role;
