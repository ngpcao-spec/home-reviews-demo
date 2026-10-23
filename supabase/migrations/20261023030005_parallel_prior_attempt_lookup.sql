create index jls_parallel_prior_uncertain_lookup on public.analysis_jls_restaurant_tasks
 (organization_id,review_id,(identity->>'configuration_sha256'),(identity->>'analysis_text_sha256'))
 where phase='jev' and request_count=1 and status not in('completed','reused');

-- The old generic plan could read every historical protocol's large JSON before
-- filtering one review. Materialize the indexed candidates first, then perform
-- bounded primary-key probes. LIMIT prevents flattening into a hash-all join.
create function public.parallel_prior_attempt_conflict(p_run uuid,p_task uuid) returns boolean
language sql stable set search_path='' set jit='off' as $$
 with scope as materialized(
  select r.id run_id,r.organization_id,p.id protocol_id,p.establishment_id,
   p.body->>'classification_configuration_sha256' config_sha,t.review_id,t.identity->>'analysis_text_sha256' text_sha
  from public.analysis_jls_restaurant_runs r join public.analysis_jls_restaurant_protocols p on p.id=r.protocol_id
  join public.analysis_jls_restaurant_tasks t on t.run_id=r.id and t.id=p_task
  where current_user='service_role' and r.id=p_run and t.phase='jev'),
 prior as materialized(
  select oldt.id,oldt.run_id from scope s join public.analysis_jls_restaurant_tasks oldt
  on oldt.organization_id=s.organization_id and oldt.review_id=s.review_id
  and oldt.identity->>'configuration_sha256'=s.config_sha and oldt.identity->>'analysis_text_sha256'=s.text_sha
  where oldt.run_id<>s.run_id and oldt.phase='jev' and oldt.request_count=1 and oldt.status not in('completed','reused'))
 select not exists(select 1 from scope) or exists(
  select 1 from scope s cross join prior
  cross join lateral(select protocol_id,consent from public.analysis_jls_restaurant_runs where id=prior.run_id limit 1) oldr
  cross join lateral(select establishment_id,body->>'classification_configuration_sha256' config_sha from public.analysis_jls_restaurant_protocols where id=oldr.protocol_id limit 1) oldp
  where oldp.establishment_id=s.establishment_id and oldp.config_sha=s.config_sha
   and oldr.consent->>'consent_source'<>'technical_qualification_no_spending' and not public.is_jls_sql_qualification(prior.run_id)
   and not public.parallel_proven_nondispatch(s.protocol_id,prior.id));
$$;
revoke all on function public.parallel_prior_attempt_conflict(uuid,uuid) from public,anon,authenticated;
grant execute on function public.parallel_prior_attempt_conflict(uuid,uuid) to service_role;
do $$declare d text;a int;b int;begin
 d=pg_get_functiondef('public.claim_parallel_report_task(uuid,text)'::regprocedure);
 a=position('if exists(select 1 from public.analysis_jls_restaurant_tasks oldt' in d);
 b=position(' then raise exception ''PARALLEL_PREVIOUS_OUTCOME_UNCERTAIN'';end if;' in substring(d from a));
 if a=0 or b=0 then raise exception 'PARALLEL_PRIOR_LOOKUP_ANCHOR_CHANGED';end if;
 d=substring(d from 1 for a-1)||'if public.parallel_prior_attempt_conflict(r.id,t.id)'||substring(d from a+b-1);
 execute d;
end $$;
