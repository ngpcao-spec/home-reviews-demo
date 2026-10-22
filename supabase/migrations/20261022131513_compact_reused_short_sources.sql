-- Certify saved short-common classifications once, without invoking a provider.
-- Reuse compact candidate protocols and the existing durable Sol-ready worker.
create function public.save_jls_compact_reused_source(b jsonb,h text) returns uuid
language plpgsql set search_path='' set jit='off' as $$
declare s jsonb=b#>'{protocol,body,source}';binding jsonb=s#>'{source_binding,dataset_binding}';
 a public.analysis_jls_snapshot_preparations;c public.analysis_jls_snapshot_preparations;
 p public.analysis_jls_restaurant_protocols;cp public.analysis_jls_restaurant_protocols;
 d jsonb=b#>'{source_input,dataset}';r jsonb;f jsonb;i jsonb;t jsonb;o jsonb;receipt jsonb;w jsonb;e jsonb;v jsonb;k text;label text;
 ids jsonb;missing jsonb;pos jsonb;neg jsonb;mentioned jsonb;expected int;rid uuid;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into a from public.analysis_jls_snapshot_preparations where id=(s#>>'{source_binding,classification_archive,id}')::uuid;
 select * into c from public.analysis_jls_snapshot_preparations where id=(s#>>'{source_binding,corpus_archive,id}')::uuid;
 select * into p from public.analysis_jls_restaurant_protocols where id=a.protocol_id;
 select * into cp from public.analysis_jls_restaurant_protocols where id=c.protocol_id;
 if h is distinct from public.jls_restaurant_hash(b) or b->>'version' is distinct from 'jls-direct4-compact-reused-source-v1'
 or s#>>'{source_binding,version}' is distinct from b->>'version' or b->>'provider_calls' is distinct from '0'
 or a.id is null or c.id is null or p.id is null or cp.id is null
 or a.sha256 is distinct from s#>>'{source_binding,classification_archive,sha256}' or c.sha256 is distinct from s#>>'{source_binding,corpus_archive,sha256}'
 or p.id::text is distinct from s#>>'{source_binding,classification_protocol,id}' or p.sha256 is distinct from s#>>'{source_binding,classification_protocol,sha256}'
 or p.body->>'version' is distinct from 'direct4-short-common-comparison-v1'
 or p.body#>>'{configuration,id}' is distinct from 'direct4_short_common_1pass_v1'
 or p.body->>'configuration_sha256' is distinct from '14c20d5525a70b200a711a41ae5e281ea64eaac910196d0a733bed64701930e3'
 or a.body#>'{protocol,body}' is distinct from p.body or a.body#>>'{protocol,sha256}' is distinct from p.sha256
 or s->'sources' is distinct from c.body#>'{source_snapshot,reviews}' or s->'sources' is distinct from cp.body#>'{source_snapshot,reviews}'
 or p.body->>'source_snapshot_sha256' is distinct from public.jls_restaurant_hash(c.body->'source_snapshot')
 or s->>'source_protocol_id' is distinct from cp.id::text or s->>'source_protocol_sha256' is distinct from cp.sha256
 or s->>'source_run_id' is distinct from a.body#>>'{run,id}'
 or b->>'organization_id' is distinct from p.organization_id::text or b->>'organization_id' is distinct from c.organization_id::text
 or b->>'organization_id' is distinct from s->>'organization_id' or b->>'establishment_id' is distinct from p.establishment_id::text
 or b->>'establishment_id' is distinct from s->>'establishment_id' or p.establishment_id is distinct from cp.establishment_id
 or s->>'authority_user_id' is distinct from p.authority_user_id::text
 or not exists(select 1 from public.organization_members where organization_id=p.organization_id and user_id=p.authority_user_id and role in('owner','admin','manager'))
 or not exists(select 1 from public.establishments where id=p.establishment_id and organization_id=p.organization_id and active)
 or d->>'id' is distinct from a.id::text or d->>'protocol_id' is distinct from cp.id::text or d->>'organization_id' is distinct from p.organization_id::text
 or d->>'sha256' is distinct from public.jls_restaurant_hash(d->'body') or s->>'dataset_sha256' is distinct from d->>'sha256'
 or d#>>'{body,version}' is distinct from 'jev-direct-categories4-dataset-v1'
 or d#>>'{body,configuration_id}' is distinct from p.body#>>'{configuration,id}'
 or d#>>'{body,configuration_sha256}' is distinct from p.body->>'configuration_sha256'
 or binding->>'dataset_id' is distinct from d->>'id' or binding->>'dataset_sha256' is distinct from d->>'sha256'
 or binding->>'snapshot_id' is distinct from cp.id::text or binding->>'snapshot_sha256' is distinct from public.jls_restaurant_hash(c.body->'source_snapshot')
 or binding#>>'{classification_configuration,id}' is distinct from p.body#>>'{configuration,id}'
 or binding#>>'{classification_configuration,sha256}' is distinct from p.body->>'configuration_sha256'
 or b#>>'{selector,algorithm}' is distinct from 'existing_selectBalancedEvidence'
 or s->>'synthesis' is distinct from 'jls-direct4-balanced-synthesis-v1.1'
 then raise exception 'COMPACT_REUSED_SOURCES_CHANGED';end if;
 select jsonb_agg(x->'review_id' order by n) into ids from jsonb_array_elements(d#>'{body,reviews}') with ordinality q(x,n);
 select coalesce(jsonb_agg(x->'id' order by x->>'id'),'[]'::jsonb) into missing from jsonb_array_elements(s->'sources')x
 where nullif(x->>'analysis_text','') is not null and not exists(select 1 from jsonb_array_elements(ids)y where y=x->'id');
 if ids is distinct from s#>'{source_binding,analysed_review_ids}' or missing is distinct from binding->'technical_missing_review_ids'
 or jsonb_array_length(ids)<>(select count(distinct x->>'review_id') from jsonb_array_elements(d#>'{body,reviews}')x)
 or jsonb_array_length(ids)<>jsonb_array_length(p.body->'items') or jsonb_array_length(s->'sources')<>(binding->>'source_reviews')::int
 or jsonb_array_length(ids)<>(binding->>'text_reviews')::int
 or s->>'statistics_sha256' is distinct from public.jls_restaurant_hash(s->'statistics') or s#>'{statistics,counts}' is distinct from d#>'{body,counts}'
 or s#>'{statistics,scope}' is distinct from jsonb_build_object('source_reviews',jsonb_array_length(s->'sources'),'analysed_text_reviews',jsonb_array_length(ids),
 'textless_statistics_only',(select count(*) from jsonb_array_elements(s->'sources')x where nullif(x->>'analysis_text','') is null),
 'technical_missing_reviews',jsonb_array_length(missing),'textual_source_reviews',jsonb_array_length(ids)+jsonb_array_length(missing))
 then raise exception 'COMPACT_REUSED_SCOPE_CHANGED';end if;
 for r in select value from jsonb_array_elements(d#>'{body,reviews}') loop
  select value into f from jsonb_array_elements(s->'sources') where value->>'id'=r->>'review_id';
  select value into i from jsonb_array_elements(p.body->'items') where value->>'review_id'=r->>'review_id';
  select value into t from jsonb_array_elements(a.body->'tasks') where value->>'phase'='jev' and value->>'review_id'=r->>'review_id';
  select value into o from jsonb_array_elements(a.body->'outcomes') where value->>'kind'='task:'||(t->>'id');
  select value into receipt from jsonb_array_elements(a.body->'receipts') where value->>'task_id'=t->>'id';
  w=(receipt->>'wire')::jsonb;
  if f is null or i is null or t is null or o is null or receipt is null
  or t->>'status' is distinct from 'completed' or t->>'request_count' is distinct from '1'
  or t->'request' is distinct from i->'jev_request' or t->>'request_sha256' is distinct from i->>'jev_request_sha256'
  or t#>>'{identity,configuration_sha256}' is distinct from p.body->>'configuration_sha256'
  or o->>'sha256' is distinct from public.jls_restaurant_hash(o->'body') or o#>>'{body,served_model}' is distinct from 'jev-1.13.0'
  or o#>>'{body,provider_fetch_invoked}' is distinct from 'true' or o#>>'{body,provider_response_received}' is distinct from 'true'
  or receipt->>'request_sha256' is distinct from t->>'request_sha256' or w->'body' is distinct from o->'body' or w->>'sha256' is distinct from o->>'sha256'
  or receipt->>'wire_sha256' is distinct from encode(extensions.digest(receipt->>'wire','sha256'),'hex')
  or r->'result' is distinct from o#>'{body,native_classification}' or r->>'result_sha256' is distinct from public.jls_restaurant_hash(r->'result')
  or r->>'raw_response_text' is distinct from o#>>'{body,raw_response_text}'
  or r->>'response_raw_sha256' is distinct from encode(extensions.digest(r->>'raw_response_text','sha256'),'hex')
  or r->>'analysis_text' is distinct from f->>'analysis_text' or r->>'analysis_text' is distinct from i->>'analysis_text'
  or r->>'analysis_text_sha256' is distinct from f->>'analysis_text_sha256'
  or r->>'analysis_text_sha256' is distinct from encode(extensions.digest(r->>'analysis_text','sha256'),'hex')
  or r->>'organization_id' is distinct from p.organization_id::text or r->>'establishment_id' is distinct from p.establishment_id::text
  or r->>'translation_source' is distinct from f->>'analysis_source' or r->'translation_provenance' is distinct from f->'translation_provenance'
  or r->>'receipt_id' is distinct from t->>'id' or r#>>'{provenance,artifact_sha256}' is distinct from o->>'sha256'
  then raise exception 'COMPACT_REUSED_CLASSIFICATION_CHANGED';end if;
 end loop;
 foreach k in array array['service','price','quality','ambiance'] loop
  v=d#>array['body','counts','categories',k];
  select coalesce(jsonb_agg(rv.val->'review_id' order by rv.val->>'review_id') filter(where rv.val#>>array['result','categories',k,'status']='classified' and rv.val#>>array['result','categories',k,'classification'] in('positive','mixed')),'[]'::jsonb),
   coalesce(jsonb_agg(rv.val->'review_id' order by rv.val->>'review_id') filter(where rv.val#>>array['result','categories',k,'status']='classified' and rv.val#>>array['result','categories',k,'classification'] in('negative','mixed')),'[]'::jsonb),
   coalesce(jsonb_agg(rv.val->'review_id' order by rv.val->>'review_id') filter(where rv.val#>>array['result','categories',k,'status']='classified' and rv.val#>>array['result','categories',k,'classification'] in('positive','negative','mixed','neutral')),'[]'::jsonb)
  into pos,neg,mentioned from jsonb_array_elements(d#>'{body,reviews}') as rv(val);
  if v->'positive_review_ids' is distinct from pos or v->'negative_review_ids' is distinct from neg or v->'mentioned_review_ids' is distinct from mentioned
  or (v->>'positive_including_mixed')::int<>jsonb_array_length(pos) or (v->>'negative_including_mixed')::int<>jsonb_array_length(neg)
  or (v->>'distinct_mentioned_reviews')::int<>jsonb_array_length(mentioned) or (v->>'denominator_reviews')::int<>jsonb_array_length(ids)
  then raise exception 'COMPACT_REUSED_COUNTS_CHANGED';end if;
  foreach label in array array['positive','negative','mixed','neutral','not_mentioned','uncertain','refused','unavailable'] loop
   select count(*) into expected from jsonb_array_elements(d#>'{body,reviews}') as rv(val) where
    case when label in('uncertain','refused') then rv.val#>>array['result','categories',k,'status']=label
    when label='unavailable' then false else rv.val#>>array['result','categories',k,'status']='classified' and rv.val#>>array['result','categories',k,'classification']=label end;
   if (v#>>array['exclusive',label])::int is distinct from expected then raise exception 'COMPACT_REUSED_COUNTS_CHANGED';end if;
  end loop;
 end loop;
 if jsonb_array_length(s->'selected') not between 1 and 32 or jsonb_array_length(s->'selected')<>(select count(distinct x->>'evidence_id') from jsonb_array_elements(s->'selected')x)
 then raise exception 'COMPACT_REUSED_SELECTION_CHANGED';end if;
 for e in select value from jsonb_array_elements(s->'selected') loop
  select value into r from jsonb_array_elements(d#>'{body,reviews}') where value->>'review_id'=e->>'review_id';
  if r is null or e->>'jev_configuration' is distinct from p.body#>>'{configuration,id}' or e->>'jev_result_sha256' is distinct from r->>'result_sha256'
  or e->'jev_native' is distinct from r#>array['result','categories',e->>'category'] or e#>>'{jev_native,status}' is distinct from 'classified'
  or e->>'polarity' not in('positive','negative') or e#>>'{jev_native,classification}' not in(e->>'polarity','mixed')
  or e->>'quote' is distinct from r->>'analysis_text' or e->>'context' is distinct from r->>'analysis_text'
  or e->>'quote_sha256' is distinct from r->>'analysis_text_sha256' or e->>'analysis_text_sha256' is distinct from r->>'analysis_text_sha256'
  or e->>'source_receipt_id' is distinct from r->>'receipt_id'
  then raise exception 'COMPACT_REUSED_EVIDENCE_CHANGED';end if;
 end loop;
 insert into public.analysis_jls_snapshot_preparations(organization_id,protocol_id,kind,body,sha256)
 values(p.organization_id,p.id,'compact_reused_source_v1',b,h) on conflict(protocol_id,kind) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_snapshot_preparations where protocol_id=p.id and kind='compact_reused_source_v1' and sha256=h and body=b;end if;
 if rid is null then raise exception 'COMPACT_REUSED_SOURCE_IMMUTABLE';end if;return rid;
end $$;
-- Only the server certifier may seal this new source kind. Runtime checks use
-- its immutable row instead of re-parsing all historical provider responses.
do $$declare d text;before text;after text;begin
 d=pg_get_functiondef('public.save_jls_snapshot_preparation(uuid,text,jsonb,text)'::regprocedure);
 before='begin';after='begin if p_kind like ''compact_reused_source%'' then raise exception ''COMPACT_SOURCE_CERTIFIER_REQUIRED'';end if;';
 execute replace(d,before,after);
 d=pg_get_functiondef('public.check_jls_compact_comparison(jsonb)'::regprocedure);
 before='or a.body->>''version'' is distinct from ''jls-direct4-no-luna-comparison-archive-v1''';
 after='or (a.body->>''version'' is distinct from ''jls-direct4-no-luna-comparison-archive-v1'' and not (a.kind=''compact_reused_source_v1'' and a.body->>''version''=''jls-direct4-compact-reused-source-v1'' and a.protocol_id::text=s#>>''{source_binding,classification_protocol,id}''))';
 if position(before in d)=0 then raise exception 'COMPACT_REUSED_RUNTIME_ANCHOR_MISSING';end if;
 execute replace(d,before,after);
end $$;
revoke all on function public.save_jls_compact_reused_source(jsonb,text) from public,anon,authenticated;
grant execute on function public.save_jls_compact_reused_source(jsonb,text) to service_role;
