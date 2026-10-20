-- A code/transaction adjudication is preparation, never a dispatch or consent.
-- No historical reservation is reset. The v31 worker and analysis contracts stay unchanged.
create table public.analysis_jls_nondispatch_adjudications(
 source_run_id uuid primary key references public.analysis_jls_restaurant_runs(id),
 organization_id uuid not null,
 proof_archive_id uuid not null unique references public.analysis_jls_snapshot_preparations(id),
 body jsonb not null, sha256 text not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.analysis_jls_nondispatch_adjudications enable row level security;
revoke all on public.analysis_jls_nondispatch_adjudications from public,anon,authenticated;
grant select,insert on public.analysis_jls_nondispatch_adjudications to service_role;
grant select on public.analysis_jls_nondispatch_adjudications to authenticated;
create policy nondispatch_read on public.analysis_jls_nondispatch_adjudications for select to authenticated using(exists(
 select 1 from public.organization_members m where m.organization_id=analysis_jls_nondispatch_adjudications.organization_id
 and m.user_id=(select auth.uid()) and m.role in('owner','admin','manager')));
create trigger immutable before update or delete on public.analysis_jls_nondispatch_adjudications
 for each row execute function public.pilot_evidence_immutable();

create function public.record_jls_nondispatch_adjudication(p_archive uuid) returns text
language plpgsql set search_path='' set jit=off as $$
declare a public.analysis_jls_snapshot_preparations;r public.analysis_jls_restaurant_runs;
 p public.analysis_jls_restaurant_protocols;v jsonb;actual jsonb;b jsonb;h text;oldsha text;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into a from public.analysis_jls_snapshot_preparations where id=p_archive;
 if a.body->>'version' is distinct from 'jls-nondispatch-proof-v1' or a.sha256 is distinct from public.jls_restaurant_hash(a.body)
 or a.body->>'finding' is distinct from 'certainly_not_started'
 or a.body->>'basis' is distinct from 'claim_batch_barrier_failure_before_fetch'
 or a.body#>>'{provenance,kind}' is distinct from 'codex_code_and_transaction_trace_adjudication'
 or a.body#>>'{offline_replay,provider_calls}' is distinct from '0'
 or not exists(select 1 from jsonb_array_elements(a.body#>'{offline_replay,observations}') x
  where x->>'sixth_claim_fails'='true' and x->>'claims'='6' and x->>'mock_http_invocations'='0'
  and x->>'release_error'='JLS_DATABASE_FAILED')
 then raise exception 'JLS_NONDISPATCH_PROOF_REQUIRED';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=(a.body->>'source_run_id')::uuid for share;
 perform pg_advisory_xact_lock(hashtextextended('jls-frozen-source:'||r.id::text,0));
 perform 1 from public.analysis_jls_restaurant_tasks where run_id=r.id order by id for share;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if r.id is null or a.protocol_id<>r.protocol_id or a.organization_id<>r.organization_id
 or r.status not in('billing_uncertain','blocked') or r.stage<>'jev' or r.worker is not null or r.lease_until is not null
 or r.error_code<>'JLS_DATABASE_FAILED' or public.jls_restaurant_hash(to_jsonb(r)) is distinct from a.body->>'run_sha256'
 or p.sha256 is distinct from a.body->>'source_protocol_sha256' or not(p.body?'continuation')
 or not public.check_jls_source_certificate(p.id)
 then raise exception 'JLS_NONDISPATCH_SOURCE_CHANGED';end if;
 select jsonb_agg(to_jsonb(t) order by t.id) into actual from public.analysis_jls_restaurant_tasks t where run_id=r.id;
 if public.jls_restaurant_hash(actual) is distinct from a.body->>'tasks_sha256'
 or exists(select 1 from public.analysis_jls_restaurant_artifacts where run_id=r.id)
 or exists(select 1 from public.analysis_jls_task_receipts where run_id=r.id)
 or exists(select 1 from public.analysis_jls_task_dispatch_intents where run_id=r.id)
 or (select count(*) from jsonb_array_elements(actual)x where x->>'status'='running' and x->>'request_count'='1')<>jsonb_array_length(a.body->'tasks')
 or (select count(distinct x->>'worker') from jsonb_array_elements(actual)x where x->>'request_count'='1')<>1
 or exists(select 1 from jsonb_array_elements(actual)x where x->>'phase'<>'jev' or not(
  (x->>'status'='running' and x->>'request_count'='1') or (x->>'status'='pending' and x->>'request_count'='0')))
 then raise exception 'JLS_NONDISPATCH_TASKS_CHANGED';end if;
 for v in select value from jsonb_array_elements(a.body->'tasks') loop
  if v->>'classification' is distinct from 'certainly_not_started' or v->>'first_execution_eligible' is distinct from 'true'
  or not exists(select 1 from public.analysis_jls_restaurant_tasks t where t.run_id=r.id and t.id=(v->>'task_id')::uuid
   and t.review_id=(v->>'review_id')::uuid and t.request_sha256=v->>'request_sha256'
   and t.worker=v->>'worker' and t.status='running' and t.request_count=1)
  then raise exception 'JLS_NONDISPATCH_ENTRY_CHANGED';end if;
 end loop;
 if (select count(distinct x->>'task_id') from jsonb_array_elements(a.body->'tasks')x)<>jsonb_array_length(a.body->'tasks')
 then raise exception 'JLS_NONDISPATCH_DUPLICATE';end if;
 b=jsonb_build_object('version','jls-nondispatch-adjudicated-v1','source_run_id',r.id,
 'source_protocol_id',p.id,'source_protocol_sha256',p.sha256,'source_run_sha256',a.body->>'run_sha256',
 'source_tasks_sha256',a.body->>'tasks_sha256','proof_archive_id',a.id,'proof_sha256',a.sha256,
 'entries',a.body->'tasks','untouched_pending_reviews',a.body->'untouched_pending_reviews',
 'new_consent_required',true,'historical_tasks_unchanged',true);
 h=public.jls_restaurant_hash(b);
 insert into public.analysis_jls_nondispatch_adjudications values(r.id,r.organization_id,a.id,b,h,clock_timestamp())
 on conflict(source_run_id) do nothing;
 select sha256 into oldsha from public.analysis_jls_nondispatch_adjudications where source_run_id=r.id;
 if oldsha<>h then raise exception 'JLS_NONDISPATCH_IMMUTABLE';end if;
 -- Extend the indexed source guards without changing any historical row or certificate.
 insert into public.analysis_jls_source_certificate_refs values(p.id,'analysis_jls_restaurant_runs',r.id) on conflict do nothing;
 insert into public.analysis_jls_source_certificate_refs select p.id,'analysis_jls_restaurant_tasks',id
 from public.analysis_jls_restaurant_tasks where run_id=r.id on conflict do nothing;
 return h;
end $$;

-- A successor is allowed only for an adjudicated terminal predecessor. The
-- original unique key is retained for ordinary partial continuations.
drop index public.jls_one_partial_continuation_per_source_run;
create unique index jls_one_partial_continuation_per_source_run on public.analysis_jls_restaurant_protocols
 ((coalesce(body#>>'{continuation,adjudication,source_run_id}',body#>>'{continuation,source_run_id}')))
 where body->>'version'='jls-direct4-frozen-corpus-v1' and body#>>'{continuation,version}'='jls-direct4-partial-continuation-v1';

-- Preserve the public function OID so already cached callers use the new guard.
do $$begin execute replace(pg_get_functiondef('public.check_jls_direct4_partial_sources(jsonb)'::regprocedure),
 'public.check_jls_direct4_partial_sources(', 'public.check_jls_direct4_partial_sources_base(');end $$;
revoke all on function public.check_jls_direct4_partial_sources_base(jsonb) from public,anon,authenticated;
grant execute on function public.check_jls_direct4_partial_sources_base(jsonb) to service_role;
create or replace function public.check_jls_direct4_partial_sources(b jsonb) returns boolean
language plpgsql stable set search_path='' set jit=off as $$
declare c jsonb=b#>'{continuation,adjudication}';a public.analysis_jls_nondispatch_adjudications;
 p public.analysis_jls_restaurant_protocols;r public.analysis_jls_restaurant_runs;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if not public.check_jls_direct4_partial_sources_base(b) then return false;end if;
 if c is null then return true;end if;
 select * into a from public.analysis_jls_nondispatch_adjudications where source_run_id=(c->>'source_run_id')::uuid;
 select * into p from public.analysis_jls_restaurant_protocols where id=(c->>'source_protocol_id')::uuid;
 select * into r from public.analysis_jls_restaurant_runs where id=a.source_run_id;
 return coalesce(a.body=c and a.sha256=public.jls_restaurant_hash(c) and p.id=r.protocol_id
 and p.sha256=c->>'source_protocol_sha256' and p.organization_id=(b->>'organization_id')::uuid
 and p.establishment_id=(b->>'establishment_id')::uuid
 and public.jls_restaurant_hash(to_jsonb(r))=c->>'source_run_sha256'
 and (b#-'{continuation,adjudication}'-'code_provenance')=(p.body-'code_provenance')
 and exists(select 1 from public.analysis_jls_snapshot_preparations x where x.id=a.proof_archive_id and x.sha256=c->>'proof_sha256')
 and exists(select 1 from public.analysis_jls_source_certificate_refs x where x.source_table='analysis_jls_restaurant_runs' and x.source_id=r.id)
 and not exists(select 1 from jsonb_array_elements(b->'pending')x join public.analysis_jls_restaurant_tasks t
 on t.review_id=(x->>'review_id')::uuid and t.run_id=r.id where not(
  (t.status='pending' and t.request_count=0) or (t.status='running' and t.request_count=1 and exists(
   select 1 from jsonb_array_elements(c->'entries')y where y->>'task_id'=t.id::text and y->>'review_id'=t.review_id::text
   and y->>'request_sha256'=t.request_sha256 and y->>'classification'='certainly_not_started')))),false);
 exception when invalid_text_representation then return false;
end $$;

create function public.prepare_jls_adjudicated_continuation(p_run uuid,p_code text) returns uuid
language plpgsql set search_path='' set jit=off as $$
declare a public.analysis_jls_nondispatch_adjudications;p public.analysis_jls_restaurant_protocols;b jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_code!~'^[a-f0-9]{40}$' then raise exception 'JLS_CODE_PROVENANCE_REQUIRED';end if;
 select * into a from public.analysis_jls_nondispatch_adjudications where source_run_id=p_run;
 if a.source_run_id is null then raise exception 'JLS_NONDISPATCH_PROOF_REQUIRED';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=(a.body->>'source_protocol_id')::uuid;
 b=jsonb_set(p.body,'{continuation,adjudication}',a.body)||jsonb_build_object('code_provenance',p_code);
 return public.save_jls_direct4_historical_protocol(b,public.jls_restaurant_hash(b));
end $$;
revoke all on function public.record_jls_nondispatch_adjudication(uuid),public.check_jls_direct4_partial_sources(jsonb),
 public.prepare_jls_adjudicated_continuation(uuid,text) from public,anon,authenticated;
grant execute on function public.record_jls_nondispatch_adjudication(uuid),public.check_jls_direct4_partial_sources(jsonb),
 public.prepare_jls_adjudicated_continuation(uuid,text) to service_role;
