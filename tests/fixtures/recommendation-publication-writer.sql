-- Read-only production definition captured 2026-10-27; no customer data.
CREATE OR REPLACE FUNCTION private.store_current_report_publication(p jsonb, sc jsonb, p_created_at timestamp with time zone, p_recovery boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare doc jsonb;bindings jsonb;ev jsonb;meta jsonb;is_stale boolean;s record;changed integer;
begin
 if p->>'state' is distinct from 'completed' or p#>>'{controls,technical_checks_passed}' is distinct from 'true'
 or p#>'{derived_report,report}' is null or p->>'generated_at' is null or sc->>'source_run_id' is distinct from p->>'current_source_run_id'
 or sc->>'establishment_id' is distinct from p->>'establishment_id' or sc->>'organization_id' is distinct from p->>'organization_id'
 or p_created_at is null then raise exception 'PUBLICATION_SOURCE_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||(p->>'establishment_id'),0));
 is_stale=coalesce((sc->>'stale')::boolean,false) or sc->>'fingerprint' is distinct from public.review_corpus_fingerprint((p->>'establishment_id')::uuid);
 is_stale=is_stale or not exists(select 1 from public.review_corpus_policy where enabled and not paused and epoch::text=sc->>'policy_epoch'); if not p_recovery and not exists(select 1 from public.historical_report_runs where id=(p->>'current_source_run_id')::uuid and establishment_id=(p->>'establishment_id')::uuid and organization_id=(p->>'organization_id')::uuid and language=p->>'language') then raise exception 'PUBLICATION_TENANT_OR_LANGUAGE_CHANGED';end if; if is_stale and not p_recovery then return false;end if;
 select coalesce(jsonb_agg(x),'[]') into bindings from (
  select jsonb_build_object('id',r->>'id','rating',r->'rating','published_at',r->'published_at','analysis_language',r->'analysis_language',
   'original_language',coalesce(r->'original_language',r#>'{translation_provenance,original_language}'),'analysis_source',r->'analysis_source','translation_provenance',r->'translation_provenance','review_detailed_rating',r->'review_detailed_rating',
   'analysis_text_sha256',coalesce(r->>'analysis_text_sha256',encode(extensions.digest(coalesce(r->>'analysis_text',''),'sha256'),'hex')),
   'original_text_sha256',coalesce(r->>'original_text_sha256',encode(extensions.digest(coalesce(r->>'original_text',''),'sha256'),'hex'))) x
  from jsonb_array_elements(p->'source_reviews') r) t;
 if jsonb_array_length(bindings)<>(sc->>'review_count')::int then raise exception 'PUBLICATION_BINDINGS_INCOMPLETE';end if;
 select coalesce(jsonb_agg(jsonb_build_object('evidence_id',e->>'evidence_id','review_id',e->>'review_id','category',e->>'category','polarity',e->>'polarity','quote_sha256',e->>'quote_sha256')),'[]') into ev from jsonb_array_elements(p#>'{controls,evidence}') e;
 select coalesce(jsonb_object_agg(k,v),'{}') into meta from jsonb_each(case when jsonb_typeof(p->'source_report')='object' then p->'source_report' else '{}'::jsonb end) x(k,v)
 where k in('generation_id','ai_status','stored_reviews_count','preferred_language','sample_average_rating','food_average','food_review_count','service_average','service_review_count','atmosphere_average','atmosphere_review_count','customer_rating_statistics','analysis_input_stats');
 doc=jsonb_build_object('id',p->'id','current_source_run_id',p->'current_source_run_id','reference_generation_id',p->'reference_generation_id','state','completed','error_code',null,
  'created_at',p->'created_at','generated_at',p->'generated_at','configuration_version',p->'configuration_version','derived_report',private.publication_generated_report(p->'derived_report'),
  'original_report',null,'raw_response',null,'corrections',null,'source_report',meta,'source_reviews','[]'::jsonb,'statistics',p->'statistics','usage',p->'usage',
  'controls',jsonb_build_object('technical_checks_passed',true,'section_issues','[]'::jsonb,'semantic_correctness_guaranteed',false,'dated_publication',true));
 insert into public.current_report_publications(establishment_id,organization_id,language,report_id,source_run_id,source_created_at,generated_at,scope,document,source_bindings,evidence_bindings,stale,stale_reason,provenance)
 values((p->>'establishment_id')::uuid,(p->>'organization_id')::uuid,p->>'language',(p->>'id')::uuid,(p->>'current_source_run_id')::uuid,p_created_at,(p->>'generated_at')::timestamptz,sc,doc,bindings,ev,is_stale,case when is_stale then 'CORPUS_CHANGED' end,
  jsonb_build_object('method',case when p_recovery then 'saved_response_dated_recovery' else 'validated_current_publication' end,'provider_calls',0))
 on conflict(establishment_id,language) do update set report_id=excluded.report_id,source_run_id=excluded.source_run_id,source_created_at=excluded.source_created_at,
  generated_at=excluded.generated_at,scope=excluded.scope,document=excluded.document,source_bindings=excluded.source_bindings,evidence_bindings=excluded.evidence_bindings,
  stale=excluded.stale,stale_reason=excluded.stale_reason,provenance=excluded.provenance,updated_at=now()
 where current_report_publications.report_id<>excluded.report_id and (excluded.source_created_at,excluded.source_run_id)>(current_report_publications.source_created_at,current_report_publications.source_run_id);
 get diagnostics changed=row_count;
 if changed>0 then
  for s in select old.current_source_run_id from public.analysis_parallel_reports old join public.historical_report_runs src on src.id=old.current_source_run_id
   where old.establishment_id=(p->>'establishment_id')::uuid and old.language=p->>'language' and old.state='completed'
   and (src.created_at,src.id)<(p_created_at,(p->>'current_source_run_id')::uuid)
   loop perform private.retention_retire_source(s.current_source_run_id,'SUPERSEDED_REPORT');end loop;
 end if;
 return changed>0;
end $function$
