-- Only the frozen reserved-control evaluation is added. Historical audits and controls remain untouched.
create table public.analysis_jev_pilot_evidence_v3_reserved_evaluations(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 control_id uuid not null references public.analysis_jev_pilot_evidence_v3_controls(id),
 engine_commit text not null check(engine_commit='91e76d8a4c130ce3b3565cbbc74771e286b0df48'),
 reference_commit text not null check(reference_commit='b64f571d36ca389cdf459b1311c35938848ce1f7'),
 version text not null check(version='pilot-evidence-v3-reserved40-evaluation-v1'),
 rule_sha256 text not null check(rule_sha256='4fd4dc9eb81e386c9e1c805a74e6494297ce5c640fdf61199e36a556f50d582a'),
 control_sha256 text not null check(control_sha256~'^[a-f0-9]{64}$'),reference_file_sha256 text not null check(reference_file_sha256~'^[a-f0-9]{64}$'),
 result_sha256 text not null check(result_sha256~'^[a-f0-9]{64}$'),result jsonb not null,
 verification_type text not null default 'exploratory_ai_reference_evaluation' check(verification_type='exploratory_ai_reference_evaluation'),
 human_validated boolean not null default false check(not human_validated),new_paid_calls int not null default 0 check(new_paid_calls=0),
 production_enabled boolean not null default false check(not production_enabled),created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(control_id,engine_commit,reference_file_sha256)
);
create index pilot_reserved_evaluation_org on public.analysis_jev_pilot_evidence_v3_reserved_evaluations(organization_id);
create index pilot_reserved_evaluation_actor on public.analysis_jev_pilot_evidence_v3_reserved_evaluations(created_by);
alter table public.analysis_jev_pilot_evidence_v3_reserved_evaluations enable row level security;
revoke all on public.analysis_jev_pilot_evidence_v3_reserved_evaluations from anon,authenticated;
grant select on public.analysis_jev_pilot_evidence_v3_reserved_evaluations to authenticated;
grant all on public.analysis_jev_pilot_evidence_v3_reserved_evaluations to service_role;
create policy pilot_reserved_evaluation_read on public.analysis_jev_pilot_evidence_v3_reserved_evaluations for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=analysis_jev_pilot_evidence_v3_reserved_evaluations.organization_id and m.user_id=(select auth.uid()) and m.role in('owner','admin','manager')));
create trigger pilot_reserved_evaluation_immutable before update or delete on public.analysis_jev_pilot_evidence_v3_reserved_evaluations for each row execute function public.pilot_evidence_immutable();
create function public.save_pilot_reserved_evaluation(p_user uuid,p_control uuid,p_result jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' as $$
declare parent public.analysis_jev_pilot_evidence_v3_controls;aid uuid;oldsha text;begin
 select * into parent from public.analysis_jev_pilot_evidence_v3_controls where id=p_control;
 if parent.id is null or not exists(select 1 from public.organization_members where organization_id=parent.organization_id and user_id=p_user and role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if p_result->>'version' is distinct from 'pilot-evidence-v3-reserved40-evaluation-v1' or p_result->'manifest'->>'engine_commit' is distinct from '91e76d8a4c130ce3b3565cbbc74771e286b0df48' or p_result->'manifest'->>'reference_commit' is distinct from 'b64f571d36ca389cdf459b1311c35938848ce1f7' or p_result->>'rule_sha256' is distinct from '4fd4dc9eb81e386c9e1c805a74e6494297ce5c640fdf61199e36a556f50d582a' or p_result->>'reference_type' is distinct from 'chatgpt_ai_reference_not_human_gold' or p_result->>'independent_human_validation' is distinct from 'false' or p_result->>'reference_labels_changed' is distinct from 'false' or p_result->>'engine_changed' is distinct from 'false' or p_result->>'production_enabled' is distinct from 'false' or p_result->>'new_paid_calls' is distinct from '0' or p_result->>'overlap_with_199' is distinct from '0' then raise exception 'RESERVED_EVALUATION_SCOPE_INVALID';end if;
 if p_result->>'control_id' is distinct from parent.id::text or p_result->>'control_sha256' is distinct from parent.result_sha256 or p_result->>'snapshot_id' is distinct from parent.snapshot_id::text or p_result->>'organization_id' is distinct from parent.organization_id::text or p_result->>'snapshot_sha256' is distinct from parent.body->>'source_sha256' then raise exception 'RESERVED_EVALUATION_SOURCE_CHANGED';end if;
 if p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_result),'sha256'),'hex') or parent.result_sha256 is distinct from encode(extensions.digest(public.jev_economy_canonical(parent.body),'sha256'),'hex') then raise exception 'RESERVED_EVALUATION_HASH_CHANGED';end if;
 if jsonb_array_length(p_result->'cases')<>40 or (select count(distinct x->>'review_id') from jsonb_array_elements(p_result->'cases') x)<>40 or (select count(*) from jsonb_array_elements(p_result->'cases') x where x->>'reference_choice'='uncertain')<>4 or exists(select 1 from jsonb_array_elements(p_result->'cases') x where not exists(select 1 from jsonb_array_elements(parent.body->'items') i where i->>'review_id'=x->>'review_id' and i->>'theme_key'=x->>'theme_key' and i->>'polarity'=x->>'polarity' and i->>'position'=x->>'position' and i->>'analysis_text'=x->>'analysis_text' and i->>'analysis_text_sha256'=x->>'analysis_text_sha256') or encode(extensions.digest(x->>'analysis_text','sha256'),'hex')<>x->>'analysis_text_sha256' or x->>'status' not in('supported_by_rule','unsupported_by_rule','review_needed')) then raise exception 'RESERVED_EVALUATION_BINDING_CHANGED';end if;
 if (p_result->'metrics'->'v3'->>'comparable')::int<>36 or (p_result->'metrics'->'v3'->>'reference_uncertain')::int<>4 or (p_result->'metrics'->'v3'->>'total')::int<>40 then raise exception 'RESERVED_EVALUATION_METRICS_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(parent.id::text||':reserved-evaluation:'||(p_result->'manifest'->>'reference_file_sha256'),0));
 select id,result_sha256 into aid,oldsha from public.analysis_jev_pilot_evidence_v3_reserved_evaluations where control_id=parent.id and engine_commit=p_result->'manifest'->>'engine_commit' and reference_file_sha256=p_result->'manifest'->>'reference_file_sha256';
 if found then if oldsha<>p_sha then raise exception 'RESERVED_EVALUATION_IMMUTABLE_CHANGED';end if;return aid;end if;
 insert into public.analysis_jev_pilot_evidence_v3_reserved_evaluations(organization_id,control_id,engine_commit,reference_commit,version,rule_sha256,control_sha256,reference_file_sha256,result_sha256,result,created_by) values(parent.organization_id,parent.id,p_result->'manifest'->>'engine_commit',p_result->'manifest'->>'reference_commit',p_result->>'version',p_result->>'rule_sha256',parent.result_sha256,p_result->'manifest'->>'reference_file_sha256',p_sha,p_result,p_user) returning id into aid;return aid;
end $$;
revoke all on function public.save_pilot_reserved_evaluation(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_pilot_reserved_evaluation(uuid,uuid,jsonb,text) to service_role;
