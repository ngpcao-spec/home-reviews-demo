-- Certify an immutable application-run dataset for the EXISTING compact
-- comparison worker. No supplier, authorization or run is created here.
create function public.save_jls_compact_parallel_source(b jsonb,h text) returns uuid
language plpgsql set search_path='' set jit='off' as $$
declare s jsonb=b#>'{protocol,body,source}';binding jsonb=s#>'{source_binding,dataset_binding}';
 a public.analysis_jls_snapshot_preparations;p public.analysis_jls_restaurant_protocols;
 d jsonb=b#>'{source_input,dataset}';r jsonb;f jsonb;e jsonb;o public.analysis_jls_restaurant_artifacts;
 t public.analysis_jls_restaurant_tasks;ids jsonb;rid uuid;k text;source_kind text;utf16_length int;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into a from public.analysis_jls_snapshot_preparations where id=(s#>>'{source_binding,classification_archive,id}')::uuid;
 select * into p from public.analysis_jls_restaurant_protocols where id=a.protocol_id;
 if h is distinct from public.jls_restaurant_hash(b) or b->>'version' is distinct from 'jls-direct4-compact-reused-source-v1'
 or b->>'provider_calls' is distinct from '0' or s#>>'{source_binding,version}' is distinct from b->>'version'
 or a.id is null or p.id is null or a.sha256 is distinct from s#>>'{source_binding,classification_archive,sha256}'
 or a.body->>'version' is distinct from 'parallel-compact-application-result-archive-v1'
 or p.body->>'version' is distinct from 'jls-direct4-parallel-no-luna-v1' or not public.check_parallel_protocol(p.body)
 or a.body#>'{protocol,body}' is distinct from p.body or a.body#>>'{protocol,sha256}' is distinct from p.sha256
 or s#>'{source_binding,corpus_archive}' is distinct from s#>'{source_binding,classification_archive}'
 or s#>'{source_binding,classification_protocol}' is distinct from jsonb_build_object('id',p.id,'sha256',p.sha256)
 or s->>'source_protocol_id' is distinct from p.id::text or s->>'source_protocol_sha256' is distinct from p.sha256
 or s->>'source_run_id' is distinct from a.body->>'run_id'
 or s->'sources' is distinct from p.body#>'{source_snapshot,reviews}' or s->'sources' is distinct from a.body#>'{source_snapshot,reviews}'
 or b->>'organization_id' is distinct from p.organization_id::text or s->>'organization_id' is distinct from p.organization_id::text
 or b->>'establishment_id' is distinct from p.establishment_id::text or s->>'establishment_id' is distinct from p.establishment_id::text
 or s->>'authority_user_id' is distinct from p.authority_user_id::text
 or not exists(select 1 from public.organization_members where organization_id=p.organization_id and user_id=p.authority_user_id and role in('owner','admin','manager'))
 or d->>'id' is distinct from s->>'source_run_id' or d->>'protocol_id' is distinct from p.id::text or d->>'organization_id' is distinct from p.organization_id::text
 or d->>'sha256' is distinct from public.jls_restaurant_hash(d->'body') or s->>'dataset_sha256' is distinct from d->>'sha256'
 or d#>>'{body,version}' is distinct from 'jev-direct-categories4-dataset-v1'
 or d#>>'{body,configuration_id}' is distinct from p.body#>>'{configuration,jev,id}'
 or d#>>'{body,configuration_sha256}' is distinct from p.body->>'classification_configuration_sha256'
 or binding->>'dataset_id' is distinct from d->>'id' or binding->>'dataset_sha256' is distinct from d->>'sha256'
 or binding->>'snapshot_id' is distinct from p.id::text or binding->>'snapshot_sha256' is distinct from p.body->>'source_snapshot_sha256'
 or binding#>'{classification_configuration}' is distinct from jsonb_build_object('id',d#>'{body,configuration_id}','sha256',d#>'{body,configuration_sha256}')
 or coalesce(binding->'technical_missing_review_ids','[]'::jsonb)<>'[]'::jsonb
 or b#>>'{selector,algorithm}' is distinct from 'jls-direct4-negative-mixed-coverage-v1'
 or b#>>'{selector,sha256}' is distinct from '17ea400f28bdc39c7218e2d62c9d9452d137b8e0b4e4891acfacfa8e0237de5e'
 or s->>'synthesis' is distinct from 'jls-direct4-balanced-synthesis-v1.1'
 then raise exception 'COMPACT_PARALLEL_SOURCE_CHANGED';end if;
 select jsonb_agg(x->'review_id' order by n) into ids from jsonb_array_elements(d#>'{body,reviews}') with ordinality q(x,n);
 if ids is distinct from s#>'{source_binding,analysed_review_ids}'
 or jsonb_array_length(ids)<>(select count(distinct x->>'review_id') from jsonb_array_elements(d#>'{body,reviews}')x)
 or jsonb_array_length(ids)<>(p.body#>>'{denominators,analytical_reviews}')::int
 or binding->>'text_reviews' is distinct from p.body#>>'{denominators,analytical_reviews}'
 or binding->>'source_reviews' is distinct from p.body#>>'{denominators,source_reviews}'
 or s->'statistics' is distinct from a.body->'statistics' or s#>'{statistics,counts}' is distinct from d#>'{body,counts}'
 or s->>'statistics_sha256' is distinct from public.jls_restaurant_hash(s->'statistics')
 then raise exception 'COMPACT_PARALLEL_SCOPE_CHANGED';end if;
 for r in select value from jsonb_array_elements(d#>'{body,reviews}') loop
  select value into f from jsonb_array_elements(s->'sources') where value->>'id'=r->>'review_id';
  select * into t from public.analysis_jls_restaurant_tasks where id=(r->>'receipt_id')::uuid and run_id=(s->>'source_run_id')::uuid and phase='jev';
  select * into o from public.analysis_jls_restaurant_artifacts where run_id=t.run_id and kind='task:'||t.id;
  if f is null or t.id is null or o.id is null or t.status not in('completed','reused')
  or o.sha256 is distinct from public.jls_restaurant_hash(o.body) or o.body->'direct4_result' is distinct from r->'result'
  or r->>'result_sha256' is distinct from public.jls_restaurant_hash(r->'result') or r#>>'{result,model}' is distinct from 'jev-1.13.0'
  or r->>'raw_response_text' is distinct from o.body->>'raw_response_text'
  or r->>'response_raw_sha256' is distinct from encode(extensions.digest(r->>'raw_response_text','sha256'),'hex')
  or r->>'analysis_text' is distinct from f->>'analysis_text' or r->>'analysis_text_sha256' is distinct from f->>'analysis_text_sha256'
  or r->>'analysis_text_sha256' is distinct from encode(extensions.digest(r->>'analysis_text','sha256'),'hex')
  or t.identity->>'analysis_text_sha256' is distinct from r->>'analysis_text_sha256'
  or t.identity->>'configuration_sha256' is distinct from d#>>'{body,configuration_sha256}'
  or r->>'organization_id' is distinct from p.organization_id::text or r->>'establishment_id' is distinct from p.establishment_id::text
  or r->>'translation_source' is distinct from f->>'analysis_source' or r->'translation_provenance' is distinct from f->'translation_provenance'
  then raise exception 'COMPACT_PARALLEL_CLASSIFICATION_CHANGED';end if;
 end loop;
 if jsonb_array_length(s->'selected') not between 1 and 32
 or jsonb_array_length(s->'selected')<>(select count(distinct x->>'evidence_id') from jsonb_array_elements(s->'selected')x)
 or jsonb_array_length(s->'originals')<>(select count(distinct x->>'review_id') from jsonb_array_elements(s->'selected')x)
 then raise exception 'COMPACT_PARALLEL_SELECTION_CHANGED';end if;
 for e in select value from jsonb_array_elements(s->'selected') loop
  select value into r from jsonb_array_elements(d#>'{body,reviews}') where value->>'review_id'=e->>'review_id';
  select value into f from jsonb_array_elements(s->'sources') where value->>'id'=e->>'review_id';
  utf16_length=length(r->>'analysis_text')+length(regexp_replace(r->>'analysis_text',U&'[^\+010000-\+10FFFF]','','g'));
  if r is null or e->>'jev_configuration' is distinct from d#>>'{body,configuration_id}' or e->>'jev_result_sha256' is distinct from r->>'result_sha256'
  or e->'jev_native' is distinct from r#>array['result','categories',e->>'category'] or e#>>'{jev_native,status}' is distinct from 'classified'
  or e->>'polarity' not in('positive','negative') or e#>>'{jev_native,classification}' not in(e->>'polarity','mixed')
  or e->>'quote' is distinct from r->>'analysis_text' or e->>'context' is distinct from r->>'analysis_text'
  or e->>'quote_sha256' is distinct from r->>'analysis_text_sha256' or e->>'analysis_text_sha256' is distinct from r->>'analysis_text_sha256'
  or e->>'quote_start'<>'0' or e->>'context_start'<>'0'
  or (e->>'quote_end')::int<>utf16_length or (e->>'context_end')::int<>utf16_length
  or e->>'source_receipt_id' is distinct from r->>'receipt_id'
  or not exists(select 1 from jsonb_array_elements(s->'originals')x where x->>'review_id'=e->>'review_id' and x->>'original_text'=f->>'original_text' and x->>'original_text_sha256'=f->>'original_text_sha256')
  or e#>>'{jev_native,classification}'='mixed' and not exists(select 1 from jsonb_array_elements(s->'selected')x where x->>'review_id'=e->>'review_id' and x->>'category'=e->>'category' and x->>'polarity'<>e->>'polarity')
  then raise exception 'COMPACT_PARALLEL_EVIDENCE_CHANGED';end if;
 end loop;
 foreach k in array array['service','price','quality','ambiance'] loop
  if exists(select 1 from jsonb_array_elements(d#>'{body,reviews}')x where x#>>array['result','categories',k,'status']='classified' and x#>>array['result','categories',k,'classification'] in('negative','mixed'))
  and not exists(select 1 from jsonb_array_elements(s->'selected')x where x->>'category'=k and x->>'polarity'='negative') then raise exception 'COMPACT_PARALLEL_NEGATIVE_COVERAGE_MISSING';end if;
 end loop;
 source_kind='compact_reused_source_parallel_v1';
 insert into public.analysis_jls_snapshot_preparations(organization_id,protocol_id,kind,body,sha256)values(p.organization_id,p.id,source_kind,b,h)
 on conflict(protocol_id,kind)do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_snapshot_preparations where protocol_id=p.id and kind=source_kind and sha256=h and body=b;end if;
 if rid is null then raise exception 'COMPACT_PARALLEL_SOURCE_IMMUTABLE';end if;return rid;
end $$;
revoke all on function public.save_jls_compact_parallel_source(jsonb,text) from public,anon,authenticated;
grant execute on function public.save_jls_compact_parallel_source(jsonb,text) to service_role;
do $$declare d text;anchor text;begin
 d=pg_get_functiondef('public.check_jls_compact_comparison(jsonb)'::regprocedure);
 anchor='a.kind=''compact_reused_source_v1''';
 if position(anchor in d)=0 then raise exception 'COMPACT_PARALLEL_SOURCE_ANCHOR_CHANGED';end if;
 execute replace(d,anchor,'a.kind in(''compact_reused_source_v1'',''compact_reused_source_parallel_v1'')');
end $$;
