begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Serialize the short projection upgrade with publication, in publisher order.
lock table public.current_report_publications in share mode nowait;
lock table public.restaurant_recommendation_sheets in access exclusive mode nowait;

create function private.recommendation_score_v2(b numeric,p integer,n integer,t integer) returns numeric
language sql immutable set search_path='' as $$
 select case when b is not null and t>0 and p>=0 and n>=0 and p+n<=t
 then greatest(0::numeric,least(6::numeric,b+(p-4::numeric*n)/t)) end
$$;

-- Preserve the V1 validator/normalizer and exact rational arithmetic. Only
-- version identity and the negative coefficient change; V1 remains auditable.
do $$declare d text;begin
 d:=pg_get_functiondef('private.recommendation_calculation_v1(jsonb)'::regprocedure);
 if (length(d)-length(replace(d,'private.recommendation_score_v1','')))/length('private.recommendation_score_v1')<>1
  or (length(d)-length(replace(d,'p-2::numeric*n','')))/length('p-2::numeric*n')<>1
  or (length(d)-length(replace(d,'internal-recommendation-v1','')))/length('internal-recommendation-v1')<>2 then
  raise exception 'RECOMMENDATION_V1_CALCULATION_CHANGED';end if;
 d:=replace(d,'private.recommendation_calculation_v1','private.recommendation_calculation_v2');
 d:=replace(d,'private.recommendation_score_v1','private.recommendation_score_v2');
 d:=replace(d,'p-2::numeric*n','p-4::numeric*n');
 d:=replace(d,'internal-recommendation-v1','internal-recommendation-v2');
 d:=replace(d,$old$'scale',jsonb_build_array(0,6)$old$,$new$'scale',jsonb_build_array(0,6),'positive_weight',1,'negative_weight',-4$new$);
 execute d;
end$$;

alter table public.restaurant_recommendation_sheets
 drop constraint restaurant_recommendation_sheets_calculation_version_check,
 alter column calculation_version set default 'internal-recommendation-v2',
 add constraint recommendation_calculation_version_check check(calculation_version in('internal-recommendation-v1','internal-recommendation-v2')),
 add constraint recommendation_calculation_version_binding check(calculation->>'version' is not null and calculation_version=calculation->>'version');

-- Future publications retain the same metadata/context plumbing; their score
-- inputs still come exclusively from their own frozen publication.
do $$declare d text;a text;begin
 d:=pg_get_functiondef('private.write_recommendation_sheet_v1(public.current_report_publications)'::regprocedure);
 a:='report_generated_at,corpus,calculation';
 if position(a in d)=0 or position('pub.source_run_id,pub.generated_at,' in d)=0
  or position('report_generated_at=excluded.report_generated_at,corpus=' in d)=0 then raise exception 'RECOMMENDATION_V1_WRITER_CHANGED';end if;
 d:=replace(d,'private.write_recommendation_sheet_v1','private.write_recommendation_sheet_v2');
 d:=replace(d,'private.recommendation_calculation_v1','private.recommendation_calculation_v2');
 d:=replace(d,a,'report_generated_at,calculation_version,corpus,calculation');
 d:=replace(d,'pub.source_run_id,pub.generated_at,','pub.source_run_id,pub.generated_at,''internal-recommendation-v2'',');
 d:=replace(d,'report_generated_at=excluded.report_generated_at,corpus=','report_generated_at=excluded.report_generated_at,calculation_version=excluded.calculation_version,corpus=');
 execute d;
 d:=pg_get_functiondef('private.capture_recommendation_sheet_v1()'::regprocedure);
 if position('private.write_recommendation_sheet_v1(new)' in d)=0 then raise exception 'RECOMMENDATION_V1_TRIGGER_CHANGED';end if;
 d:=replace(d,'private.capture_recommendation_sheet_v1','private.capture_recommendation_sheet_v2');
 d:=replace(d,'private.write_recommendation_sheet_v1','private.write_recommendation_sheet_v2');
 execute d;
end$$;
drop trigger internal_recommendation_sheet on public.current_report_publications;
create trigger internal_recommendation_sheet after insert or update on public.current_report_publications
for each row execute function private.capture_recommendation_sheet_v2();

-- Never silently use a different report or live corpus for an existing sheet.
do $$begin
 if exists(select 1 from public.restaurant_recommendation_sheets s left join public.current_report_publications p
  on p.establishment_id=s.establishment_id and p.language=s.language
  where p.report_id is null or (s.report_id,s.source_run_id,s.organization_id) is distinct from (p.report_id,p.source_run_id,p.organization_id)
   or s.corpus->'fingerprint' is distinct from p.scope->'fingerprint'
   or s.corpus->'total_reviews' is distinct from p.scope->'review_count') then
  raise exception 'RECOMMENDATION_SHEET_FROZEN_REPORT_MISMATCH';end if;
end$$;
-- Scores/version only: preserve each sheet's own stale state, report references,
-- corpus, metadata/budgets and report sections. No current-review table is read.
update public.restaurant_recommendation_sheets s set
 calculation_version='internal-recommendation-v2',calculation=private.recommendation_calculation_v2(to_jsonb(p)),
 calculated_at=clock_timestamp(),updated_at=clock_timestamp()
from public.current_report_publications p where p.establishment_id=s.establishment_id and p.language=s.language;

revoke all on function private.recommendation_score_v2(numeric,integer,integer,integer),private.recommendation_calculation_v2(jsonb),
 private.write_recommendation_sheet_v2(public.current_report_publications),private.capture_recommendation_sheet_v2()
from public,anon,authenticated,service_role;
comment on table public.restaurant_recommendation_sheets is 'Private last-report projection, not Google stars. Active formula internal-recommendation-v2: clamp(B+(exclusive_positive-4*exclusive_negative)/all_frozen_corpus_reviews,0,6). Exact numerators/denominators retained; no live-review score inputs or provider calls.';
notify pgrst,'reload schema';
commit;
