-- Explicitly abandon a failed current batch generation. Never delete or reset
-- native receipts, consumed attempts, classifications, source reviews or reports.
create table public.report_generation_abandonments(
 request_id uuid primary key references public.report_generation_requests(id),
 source_run_id uuid not null unique references public.historical_report_runs(id),
 organization_id uuid not null references public.organizations(id),
 establishment_id uuid not null references public.establishments(id),
 language text not null check(language in('fr','vi')),
 abandoned_by uuid not null references auth.users(id),
 abandoned_at timestamptz not null default now(),
 reason text not null check(reason='restart_from_zero'),
 acknowledged_possible_previous_charge boolean not null check(acknowledged_possible_previous_charge)
);
create index report_abandonments_scope on public.report_generation_abandonments(organization_id,establishment_id,language);
alter table public.report_generation_abandonments enable row level security;
revoke all on public.report_generation_abandonments from public,anon,authenticated;
grant select,insert on public.report_generation_abandonments to service_role;
create function public.guard_report_abandonment() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'REPORT_ABANDONMENT_IMMUTABLE';end $$;
create trigger report_abandonment_immutable before update or delete on public.report_generation_abandonments
 for each row execute function public.guard_report_abandonment();
revoke all on function public.guard_report_abandonment() from public,anon,authenticated;

create function public.abandon_current_report_request(p_request uuid,p_user uuid,p_acknowledge_uncertain_cost boolean)
returns jsonb language plpgsql set search_path='' set jit='off' as $$
declare q public.report_generation_requests;s public.historical_report_runs;b public.analysis_jev_batch_runs;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into q from public.report_generation_requests where id=p_request;
 if q.id is null or q.engine<>'jev_sol_v2' or q.jev_transport<>'batch_initial_v1'
 or not exists(select 1 from public.organization_members where organization_id=q.organization_id and user_id=p_user and role in('owner','admin','manager'))
 then raise exception 'FORBIDDEN';end if;
 if p_acknowledge_uncertain_cost is distinct from true then raise exception 'REPORT_RESTART_ACK_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('historical-enqueue:'||q.establishment_id::text||':'||q.language,0));
 if exists(select 1 from public.report_generation_abandonments where request_id=q.id) then
  return jsonb_build_object('abandoned',true,'request_id',q.id,'source_run_id',q.source_run_id,'provider_calls',0);
 end if;
 select * into s from public.historical_report_runs where id=q.source_run_id for update;
 select * into b from public.analysis_jev_batch_runs where current_source_run_id=q.source_run_id for update;
 if s.status<>'failed' or b.id is not null and (b.armed or b.status not in('blocked','invalid_output','billing_uncertain','authorization_expired'))
 or exists(select 1 from public.analysis_parallel_reports where id=q.comparison_id and state in('completed','needs_review'))
 or exists(select 1 from public.analysis_jev_batch_tasks where run_id=b.id and status='reserved' and lease_until>now())
 then raise exception 'REPORT_ABANDON_NOT_ALLOWED';end if;
 insert into public.report_generation_abandonments(request_id,source_run_id,organization_id,establishment_id,language,abandoned_by,reason,acknowledged_possible_previous_charge)
 values(q.id,q.source_run_id,q.organization_id,q.establishment_id,q.language,p_user,'restart_from_zero',true);
 return jsonb_build_object('abandoned',true,'request_id',q.id,'source_run_id',q.source_run_id,'provider_calls',0);
end $$;
revoke all on function public.abandon_current_report_request(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.abandon_current_report_request(uuid,uuid,boolean) to service_role;

CREATE OR REPLACE FUNCTION public.enqueue_current_report(p_establishment uuid, p_organization uuid, p_user uuid, p_language text, p_request uuid, p_legacy_model text, p_legacy_version integer)
 RETURNS historical_report_runs
 LANGUAGE plpgsql
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare r public.historical_report_runs;q public.report_generation_requests;e text;jt text;begin
 if current_user<>'service_role' or p_request is null or p_language not in('fr','vi')
 or not exists(select 1 from public.establishments where id=p_establishment and organization_id=p_organization and active)
 or not exists(select 1 from public.organization_members where organization_id=p_organization and user_id=p_user and role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('historical-enqueue:'||p_establishment::text||':'||p_language,0));
 select * into q from public.report_generation_requests where id=p_request;
 if q.id is not null then
  if q.organization_id<>p_organization or q.establishment_id<>p_establishment or q.authority_user_id<>p_user or q.language<>p_language then raise exception 'FORBIDDEN';end if;
  if exists(select 1 from public.report_generation_abandonments a where a.request_id=q.id) then raise exception 'REPORT_REQUEST_ABANDONED_NEW_ID_REQUIRED';end if;
  select * into r from public.historical_report_runs where id=q.source_run_id;return r;
 end if;
 select * into r from public.historical_report_runs where establishment_id=p_establishment and language=p_language and status in('queued','running','retry') order by created_at desc limit 1;
 if r.id is not null then return r;end if;
 if exists(select 1 from public.analysis_parallel_reports pair join public.analysis_jls_sol_ready_operations op on op.run_id=pair.run_id
 where pair.organization_id=p_organization and pair.establishment_id=p_establishment and pair.language=p_language and op.request_count=1 and (op.status='billing_uncertain' or op.receipt is null)) then raise exception 'REPORT_PREVIOUS_OUTCOME_UNCERTAIN';end if;
 if exists(select 1 from public.analysis_parallel_reports pair join public.analysis_jls_restaurant_runs j on j.id=pair.run_id where pair.establishment_id=p_establishment and pair.language=p_language and j.status in('queued','running')) then raise exception 'REPORT_OTHER_PIPELINE_RUNNING';end if;
 if exists(select 1 from public.analysis_jev_batch_runs br join public.analysis_parallel_reports bp on bp.id=br.report_id where br.current_source_run_id is not null and bp.establishment_id=p_establishment and bp.language=p_language and not exists(select 1 from public.report_generation_abandonments a where a.source_run_id=br.current_source_run_id) and (br.status='billing_uncertain' or exists(select 1 from public.analysis_jev_batch_tasks bt where bt.run_id=br.id and bt.status='unknown'))) then raise exception 'REPORT_PREVIOUS_OUTCOME_UNCERTAIN';end if;
 select engine,jev_transport into e,jt from public.report_pipeline_settings where id for share;
 if e='jev_sol_v2' then
  insert into public.historical_report_runs(organization_id,establishment_id,language,requested_by,status,snapshot,model)
  values(p_organization,p_establishment,p_language,p_user,'queued','{"analysis_version":8,"english_translation_override_policy":"verified_english_translation_overrides_v1"}', 'gpt-6.1-sol') returning * into r;
 else
  if exists(select 1 from public.historical_report_runs where establishment_id=p_establishment and language=p_language and error_code='REPORT_BILLING_UNCERTAIN_NO_RETRY') then raise exception 'REPORT_BILLING_UNCERTAIN_NO_RETRY';end if;
  r=public.enqueue_historical_report(p_establishment,p_organization,p_user,p_language,p_legacy_model,p_legacy_version);
 end if;
 insert into public.report_generation_requests(id,organization_id,establishment_id,authority_user_id,language,engine,source_run_id,jev_transport) values(p_request,p_organization,p_establishment,p_user,p_language,e,r.id,case when e='jev_sol_v2' then jt else 'individual' end);return r;
end $function$


