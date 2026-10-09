create or replace function public.write_jev_exploration(p_user uuid,p_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jev_exploratory_runs;a public.analysis_jev_exploratory_approvals;row_data jsonb;approval uuid;rid uuid;requested_version integer;role_kind text;protected boolean;
begin
 select * into r from public.analysis_jev_exploratory_runs where id=p_id for update;
 if r.id is null or not exists(select 1 from public.organization_members where organization_id=r.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if p_action='start' then
  if p_payload->>'confirm' is distinct from 'true' then raise exception 'EXPLORATORY_PAYMENT_CONFIRMATION_REQUIRED';end if;
  if r.status<>'idle' then return jsonb_build_object('status',r.status);end if;
  insert into public.analysis_jev_exploratory_tasks(run_id,review_id,repeat) select r.id,i.review_id,n from public.analysis_jev_exploratory_items i cross join generate_series(1,3) n where i.run_id=r.id and (select count(*) from jsonb_object_keys(i.v11))<>25;
  update public.analysis_jev_exploratory_runs set status='queued' where id=r.id;
 elsif p_action='approve' then
  if r.status<>'completed' or p_payload->>'confirm' is distinct from 'true' or jsonb_array_length(p_payload->'review_ids')=0 or exists(select 1 from jsonb_array_elements_text(p_payload->'review_ids') k where not exists(select 1 from public.analysis_jev_exploratory_items where run_id=p_id and review_id::text=k)) then raise exception 'EXPLORATORY_GO_REQUIRED';end if;
  for rid in select value::uuid from jsonb_array_elements_text(p_payload->'review_ids') order by value loop
   perform pg_advisory_xact_lock(hashtextextended(r.organization_id::text||rid::text,0));
   if exists(select 1 from public.analysis_jev_exploratory_review_uses where organization_id=r.organization_id and review_id=rid and purpose='evaluation') then raise exception 'EXPLORATORY_EVALUATION_CONTAMINATION';end if;
  end loop;
  insert into public.analysis_jev_exploratory_approvals(run_id,bundle_sha256,review_ids,approved_by) values(p_id,p_payload->>'bundle_sha256',p_payload->'review_ids',p_user) on conflict(run_id,bundle_sha256) do nothing;
  select id into approval from public.analysis_jev_exploratory_approvals where run_id=p_id and bundle_sha256=p_payload->>'bundle_sha256';return jsonb_build_object('approval_id',approval);
 elsif p_action='import' then
  if r.status<>'completed' then raise exception 'EXPLORATORY_NOT_COMPLETED';end if;
  select * into a from public.analysis_jev_exploratory_approvals where id=(p_payload->>'approval_id')::uuid and run_id=p_id;
  if a.id is null or a.bundle_sha256 is distinct from p_payload->>'bundle_sha256' then raise exception 'EXPLORATORY_GO_REQUIRED';end if;
  if exists(select 1 from public.analysis_jev_exploratory_corrections where import_id=(p_payload->>'import_id')::uuid and run_id=p_id) then return jsonb_build_object('reused',true);end if;
  if exists(select 1 from public.analysis_jev_exploratory_corrections where approval_id=a.id) then raise exception 'EXPLORATORY_IMPORT_IMMUTABLE';end if;
  for row_data in select * from jsonb_array_elements(p_payload->'corrections') order by value->>'review_id',value->>'theme_key' loop
   perform pg_advisory_xact_lock(hashtextextended(r.organization_id::text||(row_data->>'review_id'),0));
   if not(a.review_ids ? (row_data->>'review_id')) or not(r.config->'thresholds' ? (row_data->>'theme_key')) or row_data->>'label_source' is distinct from 'chatgpt_ai_correction' or not exists(select 1 from public.analysis_jev_exploratory_items where run_id=p_id and review_id=(row_data->>'review_id')::uuid and analysis_text_sha256=row_data->>'analysis_text_sha256' and coalesce(v11->(row_data->>'theme_key'),'null'::jsonb)=row_data->'initial_prediction') then raise exception 'EXPLORATORY_CORRECTIONS_INVALID';end if;
   -- Corrected reviews are quarantined from all future independent evaluations.
   if exists(select 1 from public.analysis_jev_exploratory_review_uses where organization_id=r.organization_id and review_id=(row_data->>'review_id')::uuid and purpose='evaluation') then raise exception 'EXPLORATORY_EVALUATION_CONTAMINATION';end if;
   insert into public.analysis_jev_exploratory_corrections(run_id,approval_id,import_id,review_id,theme_key,initial_prediction,choice,justification,corrector_model,corrected_at,imported_by,analysis_text_sha256)
   values(p_id,a.id,(p_payload->>'import_id')::uuid,(row_data->>'review_id')::uuid,row_data->>'theme_key',row_data->'initial_prediction',row_data->>'choice',row_data->>'justification',row_data->>'corrector_model',(row_data->>'corrected_at')::timestamptz,p_user,row_data->>'analysis_text_sha256');
  end loop;
 elsif p_action='reserve' then
  requested_version=(p_payload->>'future_version')::integer;role_kind=p_payload->>'purpose';
  if requested_version<=11 or role_kind not in ('calibration','evaluation') or jsonb_array_length(p_payload->'review_ids')=0 then raise exception 'EXPLORATORY_USAGE_INVALID';end if;
  for rid in select value::uuid from jsonb_array_elements_text(p_payload->'review_ids') loop
   if not exists(select 1 from public.analysis_jev_exploratory_items where run_id=p_id and review_id=rid) then raise exception 'EXPLORATORY_USAGE_INVALID';end if;
   perform pg_advisory_xact_lock(hashtextextended(r.organization_id::text||rid::text,0));
   if exists(select 1 from public.analysis_jev_exploratory_review_uses where organization_id=r.organization_id and future_version=requested_version and review_id=rid and purpose<>role_kind) then raise exception 'EXPLORATORY_EVALUATION_CONTAMINATION';end if;
   if role_kind='evaluation' and (exists(select 1 from public.analysis_jev_exploratory_corrections c join public.analysis_jev_exploratory_runs cr on cr.id=c.run_id where cr.organization_id=r.organization_id and c.review_id=rid) or exists(select 1 from public.analysis_jev_exploratory_approvals g join public.analysis_jev_exploratory_runs gr on gr.id=g.run_id where gr.organization_id=r.organization_id and g.review_ids ? rid::text)) then raise exception 'EXPLORATORY_EVALUATION_CONTAMINATION';end if;
   if role_kind='calibration' and to_regclass('public.analysis_v11_independent_holdout_items') is not null then
    execute 'select exists(select 1 from public.analysis_v11_independent_holdout_items i join public.analysis_v11_independent_holdout_sets s on s.id=i.holdout_id where s.organization_id=$1 and i.review_id=$2)' into protected using r.organization_id,rid;
    if protected then raise exception 'EXPLORATORY_PROTECTED_HOLDOUT';end if;
   end if;
   insert into public.analysis_jev_exploratory_review_uses(organization_id,future_version,review_id,purpose,source_run_id,created_by) values(r.organization_id,requested_version,rid,role_kind,p_id,p_user) on conflict do nothing;
  end loop;
 else raise exception 'EXPLORATORY_ACTION_INVALID';end if;
 insert into public.analysis_jev_exploratory_events(run_id,actor_user_id,action,payload) values(p_id,p_user,p_action,case when p_action='import' then jsonb_build_object('import_id',p_payload->'import_id','approval_id',a.id,'count',jsonb_array_length(p_payload->'corrections')) else p_payload end);
 return jsonb_build_object('status',r.status);
end $$;
