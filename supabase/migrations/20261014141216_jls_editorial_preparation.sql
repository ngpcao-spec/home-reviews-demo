-- Independent free artifacts; no execution protocol, consent, run, task or wake.
create unique index jls_editorial_preparation_identity
 on public.analysis_jev_luna_sol_events(organization_id,plan_id,action,(payload->'body'->>'language'))
 where action='prioritized_editorial_prepared_v1';
create function public.save_jls_editorial_preparation(p_body jsonb,p_sha text) returns bigint
language plpgsql security invoker set search_path='' as $$
declare p public.analysis_jev_luna_sol_plans;r public.analysis_jev_luna_sol_results;d jsonb;eid bigint;prior jsonb;expected jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jev_luna_sol_plans where id=(p_body->>'source_plan_id')::uuid;
 select * into r from public.analysis_jev_luna_sol_results where run_id=(p_body->>'source_run_id')::uuid and organization_id=p.organization_id;
 d=p_body->'draft';expected=jsonb_build_object('body',p_body,'sha256',p_sha);
 if p.id is null or r.id is null or not exists(select 1 from public.analysis_jev_luna_sol_runs where id=r.run_id and plan_id=p.id and status in('completed','needs_review')) or
  p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body),'sha256'),'hex') or
  p_body->>'version' is distinct from 'jls-prioritized-editorial-v1' or p_body->>'organization_id' is distinct from p.organization_id::text or
  p_body->>'source_plan_sha256' is distinct from p.result_sha256 or p_body->>'source_result_sha256' is distinct from r.result_sha256 or
  p_body->>'language' is null or p_body->>'language' not in('fr','vi') or p_body->>'execution_authorized' is distinct from 'false' or
  d->>'version' is distinct from p_body->>'version' or d->>'format_version' is distinct from 'jls-prioritized-recommendations-v1' or
  d->>'language' is distinct from p_body->>'language' or d->>'source_plan_sha256' is distinct from p.result_sha256 or
  d->>'paid_enabled' is distinct from 'false' or d->>'production_enabled' is distinct from 'false' or d->>'new_paid_calls' is distinct from '0' or
  d->'execution_protocol' is distinct from 'null'::jsonb or d->'spending_authorization' is distinct from 'null'::jsonb or d->'result' is distinct from 'null'::jsonb or
  d->'packet'->'statistics' is distinct from ((p.body->'statistics')-'structured_context_stats') or
  d->'packet'->>'statistics_sha256' is distinct from p.statistics_sha256 or
  jsonb_array_length(d->'coverage')<>25 or jsonb_array_length(d->'packet'->'priority_review'->'rows')<>25 or
  d->'config'->>'version' is distinct from 'jls-prioritized-editorial-v1' or d->'config'->>'max_sol_calls' is distinct from '1' or
  d->'config'->>'automatic_retry' is distinct from 'false' or d->'config'->>'new_execution_consent_required' is distinct from 'true' or
  d->'config'->>'minimum_recommendations' is distinct from '0' or d->'config'->>'maximum_recommendations' is distinct from '5' or
  d->'config'->>'luna_new_calls' is distinct from '0' or d->'config'->>'jev_new_calls' is distinct from '0' or d->'config'->>'apify_new_calls' is distinct from '0' or
  (d->'estimates'->>'estimated_input_tokens')::integer>(d->'config'->>'input_budget_tokens')::integer or
  d->'request'->>'model' is distinct from 'gpt-6.1-sol' or d->'request'->'text'->'format'->>'name' is distinct from 'jls_prioritized_editorial_v1' or
  d->'request'->'text'->'format'->'schema' is distinct from d->'schema' or
  d->>'config_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(d->'config'),'sha256'),'hex') or
  d->>'dossier_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(d->'packet'),'sha256'),'hex') or
  d->>'schema_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(d->'schema'),'sha256'),'hex') or
  d->>'prompt_sha256' is distinct from encode(extensions.digest(d->>'prompt','sha256'),'hex') or
  d->>'request_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(d->'request'),'sha256'),'hex') or
  d->'request'->'input'->0->>'content' is distinct from d->>'prompt' or
  d->'request'->'input'->1->>'content' is null or (d->'request'->'input'->1->>'content')::jsonb is distinct from d->'packet' then
   raise exception 'JLS_EDITORIAL_PREPARATION_CHANGED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p.id::text||':'||(p_body->>'language')||':editorial-v1',0));
 select id,payload into eid,prior from public.analysis_jev_luna_sol_events where organization_id=p.organization_id and plan_id=p.id and action='prioritized_editorial_prepared_v1' and payload->'body'->>'language'=p_body->>'language';
 if found then if prior is distinct from expected then raise exception 'JLS_EDITORIAL_PREPARATION_IMMUTABLE';end if;return eid;end if;
 insert into public.analysis_jev_luna_sol_events(organization_id,plan_id,action,payload) values(p.organization_id,p.id,'prioritized_editorial_prepared_v1',expected) returning id into eid;
 return eid;
end $$;
revoke all on function public.save_jls_editorial_preparation(jsonb,text) from public,anon,authenticated;
grant execute on function public.save_jls_editorial_preparation(jsonb,text) to service_role;
