-- Independent experimental V3; no historical table or provider configuration is changed.
create table public.analysis_jev_pilot_evidence_v3_controls(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 base_audit_id uuid not null unique references public.analysis_jev_pilot_evidence_v21(id),
 snapshot_id uuid not null references public.analysis_jev_pilot_snapshots(id),
 version text not null check(version='pilot-evidence-v3-new-control-v1'),
 result_sha256 text not null check(result_sha256~'^[a-f0-9]{64}$'), body jsonb not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 annotation_status text not null default 'awaiting_external_ai' check(annotation_status='awaiting_external_ai')
);
create table public.analysis_jev_pilot_evidence_v3(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 base_audit_id uuid not null unique references public.analysis_jev_pilot_evidence_v21(id),
 snapshot_id uuid not null references public.analysis_jev_pilot_snapshots(id),
 control_id uuid not null unique references public.analysis_jev_pilot_evidence_v3_controls(id),
 version text not null check(version='pilot-evidence-semantic-v3'),verifier text not null check(verifier='structured-english-predicate-binding-v1'),
 rule_sha256 text not null check(rule_sha256~'^[a-f0-9]{64}$'),base_result_sha256 text not null check(base_result_sha256~'^[a-f0-9]{64}$'),
 source_sha256 text not null check(source_sha256~'^[a-f0-9]{64}$'),posthoc_sha256 text not null check(posthoc_sha256~'^[a-f0-9]{64}$'),
 result_sha256 text not null check(result_sha256~'^[a-f0-9]{64}$'),result jsonb not null,
 new_paid_calls int not null default 0 check(new_paid_calls=0),human_validated boolean not null default false check(not human_validated),
 ai_verified boolean not null default false check(not ai_verified),production_enabled boolean not null default false check(not production_enabled),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now()
);
create index pilot_evidence3_org on public.analysis_jev_pilot_evidence_v3(organization_id);
create index pilot_evidence3_snapshot on public.analysis_jev_pilot_evidence_v3(snapshot_id);
create index pilot_evidence3_actor on public.analysis_jev_pilot_evidence_v3(created_by);
create index pilot_evidence3_control_org on public.analysis_jev_pilot_evidence_v3_controls(organization_id);
create index pilot_evidence3_control_snapshot on public.analysis_jev_pilot_evidence_v3_controls(snapshot_id);
create index pilot_evidence3_control_actor on public.analysis_jev_pilot_evidence_v3_controls(created_by);
alter table public.analysis_jev_pilot_evidence_v3 enable row level security;
alter table public.analysis_jev_pilot_evidence_v3_controls enable row level security;
revoke all on public.analysis_jev_pilot_evidence_v3,public.analysis_jev_pilot_evidence_v3_controls from anon,authenticated;
grant select on public.analysis_jev_pilot_evidence_v3,public.analysis_jev_pilot_evidence_v3_controls to authenticated;
grant all on public.analysis_jev_pilot_evidence_v3,public.analysis_jev_pilot_evidence_v3_controls to service_role;
create policy pilot_evidence3_read on public.analysis_jev_pilot_evidence_v3 for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=analysis_jev_pilot_evidence_v3.organization_id and m.user_id=(select auth.uid()) and m.role in('owner','admin','manager')));
create policy pilot_evidence3_control_read on public.analysis_jev_pilot_evidence_v3_controls for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=analysis_jev_pilot_evidence_v3_controls.organization_id and m.user_id=(select auth.uid()) and m.role in('owner','admin','manager')));
create trigger pilot_evidence3_immutable before update or delete on public.analysis_jev_pilot_evidence_v3 for each row execute function public.pilot_evidence_immutable();
create trigger pilot_evidence3_control_immutable before update or delete on public.analysis_jev_pilot_evidence_v3_controls for each row execute function public.pilot_evidence_immutable();
create function public.save_pilot_evidence_v3(p_user uuid,p_base uuid,p_control jsonb,p_control_sha text,p_result jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' as $$
declare parent public.analysis_jev_pilot_evidence_v21;s public.analysis_jev_pilot_snapshots;aid uuid;cid uuid;oldsha text;
begin
 select * into parent from public.analysis_jev_pilot_evidence_v21 where id=p_base;
 if parent.id is null or not exists(select 1 from public.organization_members where organization_id=parent.organization_id and user_id=p_user and role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 select * into s from public.analysis_jev_pilot_snapshots where id=parent.snapshot_id and organization_id=parent.organization_id;
 if s.id is null or p_result->>'base_audit_id' is distinct from parent.id::text or p_result->>'base_result_sha256' is distinct from parent.result_sha256 or p_result->>'snapshot_id' is distinct from s.id::text or p_result->>'source_sha256' is distinct from s.source_sha256 or p_control->>'source_sha256' is distinct from s.source_sha256 or p_control->>'base_result_source' is distinct from parent.id::text or p_result->>'control_sha256' is distinct from p_control_sha or p_result->>'posthoc_sha256' is distinct from p_control->>'posthoc_sha256' then raise exception 'V3_SOURCE_CHANGED';end if;
 if p_result->>'version' is distinct from 'pilot-evidence-semantic-v3' or p_result->>'verifier' is distinct from 'structured-english-predicate-binding-v1' or p_result->>'human_validated' is distinct from 'false' or p_result->>'ai_verified' is distinct from 'false' or p_result->>'new_paid_calls' is distinct from '0' or p_result->>'production_enabled' is distinct from 'false' or p_result->>'semantic_paid_enabled' is distinct from 'false' or p_control->>'version' is distinct from 'pilot-evidence-v3-new-control-v1' or p_control->>'annotation_status' is distinct from 'awaiting_external_ai' or p_control->>'new_paid_calls' is distinct from '0' or p_control->>'no_reference_invented' is distinct from 'true' then raise exception 'V3_VERSION_INVALID';end if;
 if p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_result),'sha256'),'hex') or p_control_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_control),'sha256'),'hex') or parent.result_sha256 is distinct from encode(extensions.digest(public.jev_economy_canonical(parent.result),'sha256'),'hex') then raise exception 'V3_HASH_CHANGED';end if;
 if jsonb_array_length(p_control->'items')<>40 or (select count(distinct x->>'review_id') from jsonb_array_elements(p_control->'items') x)<>40 or exists(select 1 from jsonb_array_elements(p_control->'items') x where x->'reference_annotation' is distinct from 'null'::jsonb or not exists(select 1 from jsonb_array_elements(parent.result->'checks') prev where prev->>'binding_id'=x->>'binding_id' and prev->>'review_id'=x->>'review_id' and prev->>'theme_key'=x->>'theme_key' and prev->>'polarity'=x->>'polarity') or not exists(select 1 from jsonb_array_elements(s.source->'reviews') r where r->>'id'=x->>'review_id' and r->>'analysis_text'=x->>'analysis_text' and r->>'analysis_text_sha256'=x->>'analysis_text_sha256')) then raise exception 'V3_CONTROL_CHANGED';end if;
 if jsonb_array_length(p_result->'diagnostic')<>199 or exists(select 1 from jsonb_array_elements(p_control->'items') c join jsonb_array_elements(p_result->'diagnostic') d on c->>'review_id'=d->>'review_id') then raise exception 'V3_CONTROL_OVERLAP';end if;
 if jsonb_array_length(p_result->'checks')<>jsonb_array_length(parent.result->'checks') or (select count(distinct x->>'v21_binding_id') from jsonb_array_elements(p_result->'checks') x)<>jsonb_array_length(parent.result->'checks') or p_result->'statistics' is distinct from parent.result->'statistics' then raise exception 'V3_COUNTS_CHANGED';end if;
 if exists(select 1 from jsonb_array_elements(p_result->'checks') x where x->>'status' not in('supported_by_rule','unsupported_by_rule','review_needed') or not exists(select 1 from jsonb_array_elements(parent.result->'checks') prev where prev->>'binding_id'=x->>'v21_binding_id' and prev->>'review_id'=x->>'review_id' and prev->>'theme_key'=x->>'theme_key' and prev->>'polarity'=x->>'polarity' and prev->>'analysis_text_sha256'=x->>'analysis_text_sha256' and prev->>'cache_response_sha256'=x->>'cache_response_sha256') or not exists(select 1 from jsonb_array_elements(s.source->'reviews') r where r->>'id'=x->>'review_id' and r->>'analysis_text'=x->>'analysis_text' and encode(extensions.digest(x->>'analysis_text','sha256'),'hex')=x->>'analysis_text_sha256') or (x->'statement'<>'null'::jsonb and (strpos(x->>'analysis_text',x->'statement'->>'quote')=0 or x->>'quote_sha256' is distinct from encode(extensions.digest(x->'statement'->>'quote','sha256'),'hex')))) then raise exception 'V3_BINDING_CHANGED';end if;
 if exists(select 1 from jsonb_array_elements(p_result->'checks') x join jsonb_array_elements(p_control->'items') c on c->>'review_id'=x->>'review_id' where x->>'reason'<>'RESERVED_NEW_CONTROL_NOT_EVALUATED' or x->>'status'<>'review_needed' or x->'statement'<>'null'::jsonb) then raise exception 'V3_CONTROL_CONTAMINATION';end if;
 if exists(select 1 from jsonb_array_elements(p_result->'selected') x where x->>'status'<>'supported_by_rule' or not (x->'statement'->>'actionable')::boolean or not exists(select 1 from jsonb_array_elements(p_result->'checks') c where c=x)) then raise exception 'V3_PROOF_CHANGED';end if;
 if jsonb_array_length(p_result->'recommendations')<>4 or exists(select 1 from jsonb_array_elements(p_result->'recommendations') rec cross join jsonb_array_elements_text(rec->'proof_ids') pid where not exists(select 1 from jsonb_array_elements(p_result->'selected') p where p->>'binding_id'=pid and p->>'axis'=rec->>'axis' and p->>'polarity'='negative' and rec->'claim_ids' ? (p->'statement'->>'claim'))) then raise exception 'V3_RECOMMENDATION_CHANGED';end if;
 perform pg_advisory_xact_lock(hashtextextended(parent.id::text||':pilot-evidence-semantic-v3',0));
 select id,result_sha256 into aid,oldsha from public.analysis_jev_pilot_evidence_v3 where base_audit_id=parent.id;
 if found then if oldsha<>p_sha then raise exception 'V3_IMMUTABLE_RESULT_CHANGED';end if;return aid;end if;
 insert into public.analysis_jev_pilot_evidence_v3_controls(organization_id,base_audit_id,snapshot_id,version,result_sha256,body,created_by) values(parent.organization_id,parent.id,s.id,p_control->>'version',p_control_sha,p_control,p_user) returning id into cid;
 insert into public.analysis_jev_pilot_evidence_v3(organization_id,base_audit_id,snapshot_id,control_id,version,verifier,rule_sha256,base_result_sha256,source_sha256,posthoc_sha256,result_sha256,result,created_by) values(parent.organization_id,parent.id,s.id,cid,p_result->>'version',p_result->>'verifier',p_result->>'rule_sha256',parent.result_sha256,s.source_sha256,p_result->>'posthoc_sha256',p_sha,p_result,p_user) returning id into aid;return aid;
end $$;
revoke all on function public.save_pilot_evidence_v3(uuid,uuid,jsonb,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_pilot_evidence_v3(uuid,uuid,jsonb,text,jsonb,text) to service_role;
