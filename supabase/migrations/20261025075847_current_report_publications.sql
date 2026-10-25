-- One last dated synthesis, independently of disposable generation sources.
-- No review/translation/quotation text is stored in this publication table.
create table public.current_report_publications(
 establishment_id uuid not null references public.establishments(id),organization_id uuid not null references public.organizations(id),
 language text not null check(language in('fr','vi')),report_id uuid not null,source_run_id uuid not null,
 source_created_at timestamptz not null,generated_at timestamptz not null,scope jsonb not null,document jsonb not null,
 source_bindings jsonb not null,evidence_bindings jsonb not null,stale boolean not null default false,stale_reason text,
 provenance jsonb not null default '{}',updated_at timestamptz not null default now(),primary key(establishment_id,language)
);
alter table public.current_report_publications enable row level security;
revoke all on public.current_report_publications from public,anon,authenticated,service_role;
grant select on public.current_report_publications to authenticated,service_role;
create policy publication_read on public.current_report_publications for select to authenticated using(exists(
 select 1 from public.organization_members m where m.organization_id=current_report_publications.organization_id and m.user_id=(select auth.uid()) and m.role in('owner','admin','manager')));

create function private.publication_generated_report(j jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare v jsonb;begin
 if jsonb_typeof(j)='object' then select coalesce(jsonb_object_agg(k,private.publication_generated_report(x)),'{}') into v from jsonb_each(j) t(k,x) where k not in('quote','quote_sha256');return v;
 elsif jsonb_typeof(j)='array' then select coalesce(jsonb_agg(private.publication_generated_report(x) order by n),'[]') into v from jsonb_array_elements(j) with ordinality t(x,n);return v;end if;return j;
end $$;
create function private.store_current_report_publication(p jsonb,sc jsonb,p_created_at timestamptz,p_recovery boolean default false)
returns boolean language plpgsql set search_path='' as $$
declare doc jsonb;bindings jsonb;ev jsonb;meta jsonb;is_stale boolean;s record;changed integer;
begin
 if p->>'state' is distinct from 'completed' or p#>>'{controls,technical_checks_passed}' is distinct from 'true'
 or p#>'{derived_report,report}' is null or p->>'generated_at' is null or sc->>'source_run_id' is distinct from p->>'current_source_run_id'
 or sc->>'establishment_id' is distinct from p->>'establishment_id' or sc->>'organization_id' is distinct from p->>'organization_id'
 or p_created_at is null then raise exception 'PUBLICATION_SOURCE_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||(p->>'establishment_id'),0));
 is_stale=coalesce((sc->>'stale')::boolean,false) or sc->>'fingerprint' is distinct from public.review_corpus_fingerprint((p->>'establishment_id')::uuid);
 if is_stale and not p_recovery then return false;end if;
 select coalesce(jsonb_agg(x),'[]') into bindings from (
  select jsonb_build_object('id',r->>'id','rating',r->'rating','published_at',r->'published_at','analysis_language',r->'analysis_language',
   'original_language',coalesce(r->'original_language',r#>'{translation_provenance,original_language}'),'analysis_source',r->'analysis_source',
   'analysis_text_sha256',coalesce(r->>'analysis_text_sha256',encode(extensions.digest(coalesce(r->>'analysis_text',''),'sha256'),'hex')),
   'original_text_sha256',coalesce(r->>'original_text_sha256',encode(extensions.digest(coalesce(r->>'original_text',''),'sha256'),'hex'))) x
  from jsonb_array_elements(p->'source_reviews') r) t;
 if jsonb_array_length(bindings)<>(sc->>'review_count')::int then raise exception 'PUBLICATION_BINDINGS_INCOMPLETE';end if;
 select coalesce(jsonb_agg(jsonb_build_object('evidence_id',e->>'evidence_id','review_id',e->>'review_id','category',e->>'category','polarity',e->>'polarity','quote_sha256',e->>'quote_sha256')),'[]') into ev from jsonb_array_elements(p#>'{controls,evidence}') e;
 select coalesce(jsonb_object_agg(k,v),'{}') into meta from jsonb_each(case when jsonb_typeof(p->'source_report')='object' then p->'source_report' else '{}'::jsonb end) x(k,v)
 where k in('generation_id','ai_status','stored_reviews_count','preferred_language','sample_average_rating','food_average','food_review_count','service_average','service_review_count','atmosphere_average','atmosphere_review_count');
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
end $$;
create function private.capture_current_report_publication() returns trigger language plpgsql security definer set search_path='' as $$
declare sc public.report_corpus_scopes;created timestamptz;begin
 if new.current_source_run_id is not null and new.state='completed' and new.controls->>'technical_checks_passed'='true' then
  select * into sc from public.report_corpus_scopes where source_run_id=new.current_source_run_id;
  select created_at into created from public.historical_report_runs where id=new.current_source_run_id;
  perform private.store_current_report_publication(to_jsonb(new),to_jsonb(sc),created);
 end if;return new;
end $$;
create trigger current_dated_publication after insert or update on public.analysis_parallel_reports for each row execute function private.capture_current_report_publication();
revoke all on function private.publication_generated_report(jsonb),private.store_current_report_publication(jsonb,jsonb,timestamptz,boolean),private.capture_current_report_publication() from public,anon,authenticated,service_role;

-- Successful existing reports are captured before any disposable source cleanup.
do $$declare r record;begin for r in select to_jsonb(p) p,to_jsonb(sc) sc,s.created_at from public.analysis_parallel_reports p
 join public.report_corpus_scopes sc on sc.source_run_id=p.current_source_run_id join public.historical_report_runs s on s.id=sc.source_run_id
 where p.state='completed' order by s.created_at loop perform private.store_current_report_publication(r.p,r.sc,r.created_at);end loop;end $$;

-- Reuse the same retirement/receipt/tombstone protections; only the publication
-- survives. Purge stale source copies on retained-text edits too, not only deletes.
do $$declare d text;a text;begin
 d=pg_get_functiondef('private.apply_recent_review_retention(uuid,timestamptz)'::regprocedure);
 a='update public.report_corpus_scopes set stale=fingerprint<>f,stale_reason=case when fingerprint<>f then ''CORPUS_CHANGED'' end where establishment_id=p_establishment;';
 if position(a in d)=0 then raise exception 'PUBLICATION_RETENTION_ANCHOR_CHANGED';end if;
 d=replace(d,a,a||E'\n update public.current_report_publications set stale=true,stale_reason=''CORPUS_CHANGED'',updated_at=now() where establishment_id=p_establishment and scope->>''fingerprint'' is distinct from f;\n for s in select source_run_id from public.report_corpus_scopes where establishment_id=p_establishment and stale loop perform private.retention_retire_source(s.source_run_id,''CORPUS_CHANGED'');end loop;');execute d;
end $$;

-- Lock the corpus before native run/report rows; keep consumed receipts and
-- propagate the publication guard's actual blocked state into the native run.
do $$declare d text;a text;begin
 d=pg_get_functiondef('public.jev_batch_finish(uuid,text,jsonb,jsonb,text)'::regprocedure);
 a='select * into r from public.analysis_jev_batch_runs where id=p_run for update;';
 if position(a in d)=0 then raise exception 'PUBLICATION_FINISH_ANCHOR_CHANGED';end if;
 d=replace(d,a,'select * into r from public.analysis_jev_batch_runs where id=p_run; if r.current_source_run_id is not null then perform pg_advisory_xact_lock(hashtextextended(''recent-text-corpus:''||r.establishment_id::text,0));end if; '||a);
 a='if not found then raise exception ''BATCH_PUBLICATION_BINDING_CHANGED'';end if;';
 if position(a in d)=0 then raise exception 'PUBLICATION_FINISH_STATUS_ANCHOR_CHANGED';end if;
 d=replace(d,a,a||' select state,error_code into p_status,p_error from public.analysis_parallel_reports where id=r.report_id;');execute d;
end $$;

create function public.read_current_report_publication(p_establishment uuid,p_language text) returns jsonb
language sql stable security invoker set search_path='' as $$
 with pub as (select * from public.current_report_publications where establishment_id=p_establishment and language=p_language),
 live as (
  select b, r.id,coalesce(nullif(r.original_text,''),r.text) original,
   (select candidate from (select coalesce(nullif(r.original_text,''),r.text) candidate union all select r.text union all
    select translated_text from public.review_translations where review_id=r.id and language='en' union all
    select corrected_english_text from public.analysis_review_english_translation_overrides where review_id=r.id) x
    where encode(extensions.digest(candidate,'sha256'),'hex')=b->>'analysis_text_sha256' limit 1) analysis
  from pub p cross join lateral jsonb_array_elements(p.source_bindings) b
  left join public.reviews r on r.id=(b->>'id')::uuid and r.establishment_id=p.establishment_id and r.organization_id=p.organization_id
   and r.published_at>=public.recent_review_cutoff(now()) and r.published_at<=now()
 ), available as (
  select b||jsonb_build_object('original_text',original,'analysis_text',analysis) body from live
  where id is not null and analysis is not null and encode(extensions.digest(original,'sha256'),'hex')=b->>'original_text_sha256'
 ), availability as (
  select jsonb_build_object('review_id',b->>'id','available',exists(select 1 from available a where a.body->>'id'=b->>'id'),
   'reason',case when exists(select 1 from available a where a.body->>'id'=b->>'id') then null when id is null then 'review_removed' else 'review_changed' end) body from live
 ), evidence as (
  select e||jsonb_build_object('quote',(select a.body->>'analysis_text' from available a where a.body->>'id'=e->>'review_id' and a.body->>'analysis_text_sha256'=e->>'quote_sha256'),
   'available',exists(select 1 from available a where a.body->>'id'=e->>'review_id' and a.body->>'analysis_text_sha256'=e->>'quote_sha256')) body
  from pub p cross join lateral jsonb_array_elements(p.evidence_bindings) e
 )
 select jsonb_build_object('scope',p.scope||jsonb_build_object('stale',p.stale or exists(select 1 from availability a where a.body->>'available'='false')
  or p.scope->>'fingerprint' is distinct from (select fingerprint from public.review_corpus_states where establishment_id=p.establishment_id)),
  'row',p.document||jsonb_build_object('source_reviews',coalesce((select jsonb_agg(body) from available),'[]'),
   'controls',p.document->'controls'||jsonb_build_object('evidence',coalesce((select jsonb_agg(body) from evidence),'[]'),'source_availability',coalesce((select jsonb_agg(body) from availability),'[]')))) from pub p
$$;
-- The Edge read checks membership and language before this service-only read;
-- no new client access to private verified-translation overrides is granted.
revoke all on function public.read_current_report_publication(uuid,text) from public,anon,authenticated;
grant execute on function public.read_current_report_publication(uuid,text) to service_role;
