-- Free revalidation only: no authorization, paid task, wake or provider call.
create unique index jls_pri_disclosure_revalidation_once
 on public.analysis_jls_prioritized_events(run_id,action)
 where action='prioritized_fee_disclosure_revalidated_v1';

create function public.jls_pri_validation_content(p_value jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_set(p_value,'{report,recommendations}',coalesce((select jsonb_agg(value-'status'-'visible'-'reasons' order by ordinality)
  from jsonb_array_elements(p_value->'report'->'recommendations') with ordinality),'[]'::jsonb));
$$;
create function public.save_jls_pri_revalidation(p_run uuid,p_payload jsonb) returns bigint
language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jls_prioritized_runs;o public.analysis_jls_prioritized_results;p public.analysis_jls_prioritized_protocols;
 s public.analysis_jev_pilot_snapshots;b jsonb;eid bigint;prior jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_prioritized_runs where id=p_run;
 select * into o from public.analysis_jls_prioritized_results where run_id=r.id and organization_id=r.organization_id;
 select * into p from public.analysis_jls_prioritized_protocols where id=r.protocol_id and organization_id=r.organization_id;
 select * into s from public.analysis_jev_pilot_snapshots where id=(p.body->>'source_snapshot_id')::uuid and organization_id=r.organization_id;
 b=p_payload->'body';
 if r.id is null or o.id is null or s.id is null or r.status not in('completed','needs_review') or
  not exists(select 1 from public.organization_members where organization_id=r.organization_id and user_id=r.organization_authority_user_id and role in('owner','admin','manager')) or
  b->>'version' is distinct from 'jls-fee-disclosure-revalidation-v1' or b->>'validator_version' is distinct from 'jls-prioritized-disclosure-v1.1' or
  b->>'run_id' is distinct from r.id::text or b->>'new_paid_calls' is distinct from '0' or b->>'human_validated' is distinct from 'false' or
  b->>'production_enabled' is distinct from 'false' or b->>'semantic_truth_guaranteed' is distinct from 'false' or
  b->'controls'->>'source_content_unchanged' is distinct from 'true' or
  p_payload->>'sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(b),'sha256'),'hex') or
  b->>'validation_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(b->'validation'),'sha256'),'hex') or
  b->>'original_result_sha256' is distinct from o.sha256 or
  o.sha256 is distinct from encode(extensions.digest(public.jev_economy_canonical(o.body),'sha256'),'hex') or
  b->>'source_response_sha256' is distinct from o.body->>'response_sha256' or
  b->>'source_raw_response_sha256' is distinct from o.body->>'raw_response_sha256' or
  b->>'source_report_sha256' is distinct from o.body->'validated_report'->>'raw_response_sha256' or
  b->>'source_plan_sha256' is distinct from p.body->>'source_plan_sha256' or
  b->>'snapshot_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(to_jsonb(s)),'sha256'),'hex') or
  b->>'decisions_sha256' is distinct from o.body->>'decisions_sha256' or
  coalesce(b->'provenance'->>'commit','') !~ '^[a-f0-9]{40}$' or
  (select count(*) from jsonb_each_text(b->'provenance'->'files'))<3 or
  exists(select 1 from jsonb_each_text(b->'provenance'->'files') where value !~ '^[a-f0-9]{64}$') or
  public.jls_pri_validation_content(b->'validation') is distinct from public.jls_pri_validation_content(o.body->'validated_report') then
   raise exception 'JLS_PRI_REVALIDATION_CHANGED';end if;
 perform pg_advisory_xact_lock(hashtextextended(r.id::text||':disclosure-revalidation-v1',0));
 select id,payload into eid,prior from public.analysis_jls_prioritized_events where run_id=r.id and action='prioritized_fee_disclosure_revalidated_v1';
 if found then if prior is distinct from p_payload then raise exception 'JLS_PRI_REVALIDATION_IMMUTABLE';end if;return eid;end if;
 insert into public.analysis_jls_prioritized_events(organization_id,protocol_id,run_id,action,payload)
 values(r.organization_id,r.protocol_id,r.id,'prioritized_fee_disclosure_revalidated_v1',p_payload) returning id into eid;
 return eid;
end $$;
revoke all on function public.jls_pri_validation_content(jsonb),public.save_jls_pri_revalidation(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.jls_pri_validation_content(jsonb),public.save_jls_pri_revalidation(uuid,jsonb) to service_role;
-- Existing append-only trigger, organization RLS and service-only writes are retained.
