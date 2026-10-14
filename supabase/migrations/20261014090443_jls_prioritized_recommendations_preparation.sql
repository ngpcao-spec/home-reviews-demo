-- Preparation artifacts reuse the immutable, organisation-isolated event journal.
-- No run, task, consent, scheduler or spending endpoint is created or altered.
create unique index jls_prioritized_preparation_identity
 on public.analysis_jev_luna_sol_events(organization_id,plan_id,action,(payload->'body'->>'language'))
 where action='prioritized_report_format_prepared_v1';
create function public.save_jls_prioritized_preparation(p_body jsonb,p_sha text)
 returns bigint language plpgsql security invoker set search_path='' as $$
declare p public.analysis_jev_luna_sol_plans; r public.analysis_jev_luna_sol_results;
 d jsonb; eid bigint; e jsonb;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN'; end if;
 select * into p from public.analysis_jev_luna_sol_plans where id=(p_body->>'source_plan_id')::uuid;
 select * into r from public.analysis_jev_luna_sol_results where run_id=(p_body->>'source_run_id')::uuid and organization_id=p.organization_id;
 d=p_body->'draft';
 if p.id is null or r.id is null or not exists(select 1 from public.analysis_jev_luna_sol_runs where id=r.run_id and plan_id=p.id and status in('completed','needs_review')) or
 p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body),'sha256'),'hex') or
 p_body->>'version' is distinct from 'jls-prioritized-recommendations-v1' or p_body->>'organization_id' is distinct from p.organization_id::text or
 p_body->>'source_result_sha256' is distinct from r.result_sha256 or p_body->>'source_plan_sha256' is distinct from p.result_sha256 or
 p_body->>'language' not in('fr','vi') or p_body->>'language' is null or p_body->>'execution_authorized' is distinct from 'false' or
 d->>'version' is distinct from p_body->>'version' or d->>'language' is distinct from p_body->>'language' or
 d->>'source_plan_sha256' is distinct from p.result_sha256 or d->>'paid_enabled' is distinct from 'false' or
 d->>'production_enabled' is distinct from 'false' or d->>'new_paid_calls' is distinct from '0' or d->'spending_authorization' is distinct from 'null'::jsonb or d->'result' is distinct from 'null'::jsonb or
 d->'packet'->'statistics' is distinct from p.body->'statistics' or d->'packet'->>'statistics_sha256' is distinct from p.statistics_sha256 or
 d->'config'->>'max_sol_calls' is distinct from '1' or d->'config'->>'max_luna_calls' is distinct from '24' or d->'config'->>'automatic_retry' is distinct from 'false' or
 d->'config'->>'new_execution_consent_required' is distinct from 'true' or d->'config'->>'maximum_recommendations' is distinct from '5' or
 d->'request'->>'model' is distinct from 'gpt-6.1-sol' or d->'request'->'text'->'format'->>'name' is distinct from 'jls_prioritized_recommendations_v1' or
 d->'request'->'text'->'format'->'schema' is distinct from d->'schema' or
 d->>'config_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(d->'config'),'sha256'),'hex') or
 d->>'dossier_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(d->'packet'),'sha256'),'hex') or
 d->>'request_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(d->'request'),'sha256'),'hex') or
 d->>'prompt_sha256' is distinct from encode(extensions.digest(d->>'prompt','sha256'),'hex') or
 d->>'schema_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(d->'schema'),'sha256'),'hex') or
 d->>'decisions_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(r.body->'luna_decisions'),'sha256'),'hex') or
 d->'request'->'input'->0->>'content' is distinct from d->>'prompt' or (d->'request'->'input'->1->>'content')::jsonb is distinct from d->'packet' then
 raise exception 'JLS_PRIORITIZED_PREPARATION_CHANGED'; end if;
 for e in select value from jsonb_array_elements(d->'packet'->'evidence') loop
  if not exists(select 1 from jsonb_array_elements(p.body->'selected') s
   join jsonb_array_elements(r.body->'luna_decisions') v on v->>'evidence_id'=s->>'evidence_id'
   where v->>'status'='ACCEPTED' and e->>'evidence_id'=s->>'evidence_id' and e->>'quote'=s->>'quote' and e->>'quote_sha256'=s->>'quote_sha256'
    and e->>'review_id'=s->>'review_id' and e->>'theme_key'=s->>'theme_key' and e->>'polarity'=s->>'polarity' and e->>'context'=s->>'context'
    and e->>'context_sha256'=encode(extensions.digest(s->>'context','sha256'),'hex') and e->>'analysis_text_sha256'=s->>'analysis_text_sha256') then
   raise exception 'JLS_PRIORITIZED_EVIDENCE_CHANGED'; end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(p.id::text||':prioritized:'||(p_body->>'language'),0));
 select id into eid from public.analysis_jev_luna_sol_events where organization_id=p.organization_id and plan_id=p.id
  and action='prioritized_report_format_prepared_v1' and payload->'body'->>'language'=p_body->>'language';
 if found then
  if not exists(select 1 from public.analysis_jev_luna_sol_events where id=eid and payload->>'sha256'=p_sha) then raise exception 'JLS_PRIORITIZED_PREPARATION_IMMUTABLE'; end if;
  return eid;
 end if;
 insert into public.analysis_jev_luna_sol_events(organization_id,plan_id,action,payload)
 values(p.organization_id,p.id,'prioritized_report_format_prepared_v1',jsonb_build_object('body',p_body,'sha256',p_sha)) returning id into eid;
 return eid;
end $$;
revoke all on function public.save_jls_prioritized_preparation(jsonb,text) from public,anon,authenticated;
grant execute on function public.save_jls_prioritized_preparation(jsonb,text) to service_role;
