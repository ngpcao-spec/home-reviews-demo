-- Persistence only. No consent, run, provider task, dispatch or timeout increase.
-- The inbox references the reserved task, never the hot run row: receipt inserts
-- must not inherit a run-row KEY SHARE lock through a foreign key.
create table public.analysis_jls_task_receipts (
 task_id uuid primary key references public.analysis_jls_restaurant_tasks(id),
 run_id uuid not null, organization_id uuid not null, protocol_id uuid not null,
 protocol_sha256 text not null check(protocol_sha256 ~ '^[a-f0-9]{64}$'),
 request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
 worker text not null, phase text not null check(phase in('jev','luna')),
 outcome_status text not null check(outcome_status in('completed','needs_review','invalid_output','billing_uncertain','blocked')),
 outcome_sha256 text not null check(outcome_sha256 ~ '^[a-f0-9]{64}$'),
 wire text not null, wire_sha256 text not null check(wire_sha256 ~ '^[a-f0-9]{64}$'),
 received_at timestamptz not null default clock_timestamp()
);
create index jls_task_receipt_run on public.analysis_jls_task_receipts(run_id,organization_id);
alter table public.analysis_jls_task_receipts enable row level security;
revoke all on public.analysis_jls_task_receipts from public,anon,authenticated;
grant select on public.analysis_jls_task_receipts to authenticated;
grant select,insert on public.analysis_jls_task_receipts to service_role;
create policy receipt_org_read on public.analysis_jls_task_receipts for select to authenticated using (
 exists(select 1 from public.organization_members m where m.organization_id=analysis_jls_task_receipts.organization_id
 and m.user_id=(select auth.uid()) and m.role in('owner','admin','manager'))
);
create trigger immutable before update or delete on public.analysis_jls_task_receipts for each row execute function public.pilot_evidence_immutable();

create function public.save_jls_restaurant_receipt(p_task uuid,p_worker text,p_wire text,p_sha text) returns boolean
language plpgsql set search_path='' set jit='off' as $$
declare t public.analysis_jls_restaurant_tasks;r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;
 v jsonb;oldsha text;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_wire is null or octet_length(p_wire)>4194304 or p_sha is distinct from encode(extensions.digest(p_wire,'sha256'),'hex') then return false;end if;
 v=p_wire::jsonb;
 select * into t from public.analysis_jls_restaurant_tasks where id=p_task;
 select * into r from public.analysis_jls_restaurant_runs where id=t.run_id;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 -- Retaining an already reserved response is not a new spending authorization.
 -- It remains possible after lease expiry; it never changes the historical run.
 if t.id is null or t.request_count is distinct from 1 or t.worker is distinct from p_worker or t.phase not in('jev','luna')
 or t.organization_id is distinct from r.organization_id or r.organization_id is distinct from p.organization_id
 or v->>'version' is distinct from 'jls-restaurant-receipt-v1' or v->>'task_id' is distinct from t.id::text
 or v->>'worker' is distinct from p_worker or v->>'protocol_sha256' is distinct from p.sha256
 or coalesce(v->>'source_kind','') not in('provider_outcome','existing_artifact')
 or coalesce(v->>'status','') not in('completed','needs_review','invalid_output','billing_uncertain','blocked')
 or v->'body'->>'request_sha256' is distinct from t.request_sha256 or v->'body'->>'phase' is distinct from t.phase
 or v->>'sha256' is distinct from public.jls_restaurant_hash(v->'body')
 or v->'body'->>'raw_response_text' is not null and v->'body'->>'raw_response_sha256' is distinct from encode(extensions.digest(v->'body'->>'raw_response_text','sha256'),'hex')
 then return false;end if;
 if v->>'source_kind'='existing_artifact' and not exists(select 1 from public.analysis_jls_restaurant_artifacts a
 where a.run_id=t.run_id and a.kind='task:'||t.id and a.sha256=v->>'sha256' and a.body=v->'body' and t.status=v->>'status') then return false;end if;
 select wire_sha256 into oldsha from public.analysis_jls_task_receipts where task_id=t.id;
 if oldsha is not null then return oldsha=p_sha;end if;
 insert into public.analysis_jls_task_receipts(task_id,run_id,organization_id,protocol_id,protocol_sha256,request_sha256,worker,phase,outcome_status,outcome_sha256,wire,wire_sha256)
 values(t.id,t.run_id,t.organization_id,p.id,p.sha256,t.request_sha256,p_worker,t.phase,v->>'status',v->>'sha256',p_wire,p_sha)
 on conflict(task_id) do nothing;
 return exists(select 1 from public.analysis_jls_task_receipts where task_id=t.id and wire_sha256=p_sha);
 exception when invalid_text_representation then return false;
end $$;

-- Shared application of an outcome. Hash work precedes all row locks; successful
-- results use compatible SHARE locks, then an individual task lock. Error paths
-- take the run lock first, consistently with task reservation, avoiding upgrades.
create function public.apply_jls_restaurant_outcome(p_task uuid,p_worker text,p_status text,p_body jsonb,p_sha text,p_receipt_sha text default null)
returns boolean language plpgsql set search_path='' set jit='off' as $$
declare t public.analysis_jls_restaurant_tasks;r public.analysis_jls_restaurant_runs;oldsha text;receipt public.analysis_jls_task_receipts;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_status is null or p_status not in('completed','needs_review','invalid_output','billing_uncertain','blocked') then return false;end if;
 if p_receipt_sha is null then
  if p_sha is distinct from public.jls_restaurant_hash(p_body) then return false;end if;
 else
  select * into receipt from public.analysis_jls_task_receipts where task_id=p_task and wire_sha256=p_receipt_sha;
  if receipt.task_id is null or receipt.worker is distinct from p_worker or receipt.outcome_status is distinct from p_status
  or receipt.outcome_sha256 is distinct from p_sha or (receipt.wire::jsonb)->'body' is distinct from p_body
  or receipt.wire_sha256 is distinct from encode(extensions.digest(receipt.wire,'sha256'),'hex') then return false;end if;
 end if;
 select * into t from public.analysis_jls_restaurant_tasks where id=p_task;
 if t.id is null or t.request_count is distinct from 1 or t.worker is distinct from p_worker then return false;end if;
 select sha256 into oldsha from public.analysis_jls_restaurant_artifacts where run_id=t.run_id and kind='task:'||t.id;
 if t.status=p_status and oldsha=p_sha then return true;end if;
 if p_status='completed' then select * into r from public.analysis_jls_restaurant_runs where id=t.run_id for share;
 else select * into r from public.analysis_jls_restaurant_runs where id=t.run_id for update;end if;
 if r.id is null or r.status not in('queued','running') then return false;end if;
 if p_receipt_sha is null and (r.worker is distinct from p_worker or r.lease_until is null or r.lease_until<=clock_timestamp()) then return false;end if;
 select * into t from public.analysis_jls_restaurant_tasks where id=p_task for update;
 select sha256 into oldsha from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='task:'||t.id;
 if t.status=p_status and oldsha=p_sha then return true;end if;
 if t.status is distinct from 'running' or t.request_count is distinct from 1 or t.worker is distinct from p_worker
 or t.organization_id is distinct from r.organization_id or oldsha is not null then return false;end if;
 insert into public.analysis_jls_restaurant_artifacts(run_id,organization_id,kind,body,sha256) values(r.id,r.organization_id,'task:'||t.id,p_body,p_sha);
 if t.phase='jev' and t.cache_id is not null then
  update public.analysis_jev_review_cache set status=case when p_status='completed' then 'completed' else 'billing_uncertain' end,
  response=p_body->'jev_response',theme_results=p_body->'theme_results',input_tokens=(p_body->>'input_tokens')::bigint,
  output_tokens=(p_body->>'output_tokens')::bigint,cost_usd=(p_body->>'cost_usd')::numeric,usage_complete=p_status='completed',
  served_model=p_body->>'served_model',processed_at=now(),error_code=p_body->>'error_code' where id=t.cache_id;
 end if;
 update public.analysis_jls_restaurant_tasks set status=p_status,error_code=p_body->>'error_code',completed_at=now() where id=t.id;
 if p_status<>'completed' then update public.analysis_jls_restaurant_runs set status=case when p_status in('billing_uncertain','needs_review') then p_status else 'blocked' end,
 error_code=p_body->>'error_code' where id=r.id and status in('queued','running');end if;
 return true;
end $$;
create or replace function public.finish_jls_restaurant_task(p_task uuid,p_worker text,p_status text,p_body jsonb,p_sha text)
returns boolean language sql set search_path='' as $$
 select public.apply_jls_restaurant_outcome(p_task,p_worker,p_status,p_body,p_sha,null)
$$;
create function public.finish_jls_restaurant_receipt(p_task uuid) returns boolean language plpgsql set search_path='' set jit='off' as $$
declare x public.analysis_jls_task_receipts;v jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into x from public.analysis_jls_task_receipts where task_id=p_task;
 if x.task_id is null then return false;end if;
 v=x.wire::jsonb;
 return public.apply_jls_restaurant_outcome(x.task_id,x.worker,x.outcome_status,v->'body',x.outcome_sha256,x.wire_sha256);
end $$;
create function public.flush_jls_restaurant_receipts(p_run uuid) returns jsonb language plpgsql set search_path='' set jit='off' as $$
declare r public.analysis_jls_restaurant_runs;x record;saved int=0;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run;
 if r.id is null then raise exception 'FORBIDDEN';end if;
 if r.status not in('queued','running') then return jsonb_build_object('saved',0,'historical_status_preserved',true,'provider_calls',0,'requires_explicit_continuation',true);end if;
 for x in select t.id from public.analysis_jls_restaurant_tasks t join public.analysis_jls_task_receipts s on s.task_id=t.id
 where t.run_id=r.id and t.status='running' and t.request_count=1 order by t.task_key limit 8 loop
  if public.finish_jls_restaurant_receipt(x.id) then saved=saved+1;else exit;end if;
 end loop;
 return jsonb_build_object('saved',saved,'provider_calls',0,'new_attempts',0);
end $$;

create or replace function public.save_jls_restaurant_artifact(p_run uuid,p_worker text,p_kind text,p_body jsonb,p_sha text) returns boolean
language plpgsql set search_path='' set jit='off' as $$
declare r public.analysis_jls_restaurant_runs;oldsha text;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_sha is distinct from public.jls_restaurant_hash(p_body) then return false;end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for share;
 if r.id is null or r.worker is distinct from p_worker or r.lease_until is null or r.lease_until<=clock_timestamp() then return false;end if;
 insert into public.analysis_jls_restaurant_artifacts(run_id,organization_id,kind,body,sha256) values(r.id,r.organization_id,p_kind,p_body,p_sha)
 on conflict(run_id,kind) do nothing;
 select sha256 into oldsha from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind=p_kind;
 return oldsha=p_sha;
end $$;
-- An overlapping wake must check its live lease before hashing the full frozen
-- protocol, rather than holding the hot run row through that repeated work.
do $$declare d text;old text;replacement text;begin
 d=pg_get_functiondef('public.claim_jls_restaurant_tick(uuid,text)'::regprocedure);
 old='if not public.jls_restaurant_valid(r.id) then update public.analysis_jls_restaurant_runs set status=''authorization_expired'',error_code=''JLS_AUTHORIZATION_EXPIRED'' where id=r.id;return false;end if;'||chr(10)||' if r.lease_until>now() then return false;end if;';
 replacement='if r.lease_until>clock_timestamp() then return false;end if;'||chr(10)||' if not public.jls_restaurant_valid(r.id) then update public.analysis_jls_restaurant_runs set status=''authorization_expired'',error_code=''JLS_AUTHORIZATION_EXPIRED'' where id=r.id;return false;end if;';
 if position(old in d)=0 then raise exception 'JLS_TICK_EXPECTED_GUARD_NOT_FOUND';end if;
 execute replace(d,old,replacement);
end $$;
revoke all on function public.save_jls_restaurant_receipt(uuid,text,text,text),public.apply_jls_restaurant_outcome(uuid,text,text,jsonb,text,text),
 public.finish_jls_restaurant_receipt(uuid),public.flush_jls_restaurant_receipts(uuid) from public,anon,authenticated;
grant execute on function public.save_jls_restaurant_receipt(uuid,text,text,text),public.apply_jls_restaurant_outcome(uuid,text,text,jsonb,text,text),
 public.finish_jls_restaurant_receipt(uuid),public.flush_jls_restaurant_receipts(uuid) to service_role;
