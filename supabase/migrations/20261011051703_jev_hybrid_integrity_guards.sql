-- Additional preparation integrity; spending stays closed.
alter table public.analysis_jev_hybrid_plans add unique(id,organization_id);
alter table public.analysis_jev_hybrid_authorizations add unique(id,organization_id,plan_id),add foreign key(plan_id,organization_id) references public.analysis_jev_hybrid_plans(id,organization_id);
alter table public.analysis_jev_hybrid_jobs add unique(id,organization_id),add foreign key(plan_id,organization_id) references public.analysis_jev_hybrid_plans(id,organization_id),add foreign key(authorization_id,organization_id,plan_id) references public.analysis_jev_hybrid_authorizations(id,organization_id,plan_id);
alter table public.analysis_jev_hybrid_verdicts add foreign key(job_id,organization_id) references public.analysis_jev_hybrid_jobs(id,organization_id);
alter table public.analysis_jev_hybrid_events add foreign key(plan_id,organization_id) references public.analysis_jev_hybrid_plans(id,organization_id),add foreign key(job_id,organization_id) references public.analysis_jev_hybrid_jobs(id,organization_id);
create trigger hybrid_job_no_delete before delete on public.analysis_jev_hybrid_jobs for each row execute function public.pilot_evidence_immutable();
create function public.hybrid_sql_integrity_guard() returns trigger language plpgsql security invoker set search_path='' as $$declare s public.analysis_jev_pilot_snapshots;dist jsonb;axis_name text;stars_name text;rows_kind text;begin
 select * into s from public.analysis_jev_pilot_snapshots where id=new.source_snapshot_id;
 if new.body->'estimates'->'rates' is distinct from s.rates or new.body->'request_preview'->>'model' is distinct from 'gpt-6.1-sol' or new.body->'request_preview'->'reasoning'->>'effort' is distinct from 'low' or (new.body->'estimates'->>'jev_new_requests')::int<>0 or new.body->'estimates'->'actual_cost_usd' is distinct from 'null'::jsonb then raise exception 'HYBRID_REQUEST_SCOPE_INVALID';end if;
 if (select count(distinct t->>'theme_key') from jsonb_array_elements(new.body->'analytics'->'themes') t)<>25 or exists(select 1 from jsonb_array_elements(new.body->'analytics'->'themes') t where t->>'positive_reviews'<>t->>'positive_mentions' or t->>'negative_reviews'<>t->>'negative_mentions') then raise exception 'HYBRID_REVIEW_COUNTS_CHANGED';end if;
 foreach axis_name in array array['service','quality','price','atmosphere'] loop
  if not exists(select 1 from jsonb_array_elements(new.body->'analytics'->'axes') a where a->>'key'=axis_name
   and (a->>'positive_mentions')::int=(select coalesce(sum((t->>'positive_mentions')::int),0) from jsonb_array_elements(new.body->'analytics'->'themes') t where t->>'axis'=axis_name)
   and (a->>'negative_mentions')::int=(select coalesce(sum((t->>'negative_mentions')::int),0) from jsonb_array_elements(new.body->'analytics'->'themes') t where t->>'axis'=axis_name)
   and (a->>'positive_review_count')::int=(select count(distinct c.review_id) from jsonb_array_elements(new.body->'cache_fingerprints') f join public.analysis_jev_review_cache c on c.id=(f->>'cache_id')::uuid join jsonb_array_elements(new.body->'analytics'->'themes') t on t->>'axis'=axis_name where c.theme_results->(t->>'theme_key')->>'choice' in('positive','both'))
   and (a->>'negative_review_count')::int=(select count(distinct c.review_id) from jsonb_array_elements(new.body->'cache_fingerprints') f join public.analysis_jev_review_cache c on c.id=(f->>'cache_id')::uuid join jsonb_array_elements(new.body->'analytics'->'themes') t on t->>'axis'=axis_name where c.theme_results->(t->>'theme_key')->>'choice' in('negative','both'))) then raise exception 'HYBRID_AXIS_SQL_COUNTS_CHANGED';end if;
 end loop;
 foreach rows_kind in array array['stored','with_text','analysed'] loop
  select jsonb_object_agg(n::text,(select count(*) from jsonb_array_elements(s.source->'reviews') r where (r->>'rating')::int=n and (rows_kind<>'with_text' or btrim(r->>'original_text')<>'') and (rows_kind<>'analysed' or exists(select 1 from jsonb_array_elements(new.body->'cache_fingerprints') f where f->>'review_id'=r->>'id')))) into dist from generate_series(1,5) n;
  if new.body->'analytics'->'star_distribution'->rows_kind is distinct from dist then raise exception 'HYBRID_STAR_COUNTS_CHANGED';end if;
 end loop;
 return new;end $$;
create trigger hybrid_sql_integrity before insert on public.analysis_jev_hybrid_plans for each row execute function public.hybrid_sql_integrity_guard();
revoke all on function public.hybrid_sql_integrity_guard() from public,anon,authenticated;
