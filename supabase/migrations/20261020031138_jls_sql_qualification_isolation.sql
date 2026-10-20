-- Isolated, explicitly non-spending fixtures on the SAME protocol and RPCs.
-- No historical row gains a column (to_jsonb hashes remain unchanged).
create table public.analysis_jls_sql_qualifications(
 id uuid primary key default gen_random_uuid(), protocol_id uuid not null references public.analysis_jls_restaurant_protocols(id),
 organization_id uuid not null, protocol_sha256 text not null, run_id uuid not null unique,
 nonce text not null, expires_at timestamptz not null, created_at timestamptz not null default clock_timestamp(),
 provider_calls int not null default 0 check(provider_calls=0),unique(protocol_id,nonce)
);
alter table public.analysis_jls_sql_qualifications enable row level security;
revoke all on public.analysis_jls_sql_qualifications from public,anon,authenticated;
grant select,insert on public.analysis_jls_sql_qualifications to service_role;
create trigger immutable before update or delete on public.analysis_jls_sql_qualifications for each row execute function public.pilot_evidence_immutable();
-- Exactly one real execution per protocol is still enforced by a unique index.
alter table public.analysis_jls_restaurant_runs drop constraint analysis_jls_restaurant_runs_protocol_id_key;
create unique index jls_one_spending_run_per_protocol on public.analysis_jls_restaurant_runs(protocol_id)
 where consent->>'consent_source' is distinct from 'technical_qualification_no_spending';

create function public.is_jls_sql_qualification(p_run uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.analysis_jls_sql_qualifications q join public.analysis_jls_restaurant_runs r on r.id=q.run_id
 where r.id=p_run and q.protocol_id=r.protocol_id and q.organization_id=r.organization_id
 and r.consent->>'consent_source'='technical_qualification_no_spending' and r.consent->>'qualification_id'=q.id::text
 and r.consent->>'protocol_sha256'=q.protocol_sha256)
$$;
alter table public.analysis_jls_sol_ready_operations drop constraint analysis_jls_sol_ready_operations_check;
alter table public.analysis_jls_sol_ready_operations add check(
 (mode='mock' and run_id is null and task_id is null and protocol_id is null and protocol_body is not null and nonce is not null)
 or (mode='paid' and run_id is not null and task_id is not null and protocol_id is not null and protocol_body is null and not public.is_jls_sql_qualification(run_id))
 or (mode='mock' and run_id is not null and task_id is not null and protocol_id is not null and protocol_body is null and public.is_jls_sql_qualification(run_id)));
create function public.start_jls_sql_qualification(p_protocol uuid,p_nonce text) returns uuid
language plpgsql set search_path='' set jit=off as $$
declare p public.analysis_jls_restaurant_protocols;q public.analysis_jls_sql_qualifications;rid uuid=gen_random_uuid();v jsonb;c jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_nonce !~ '^[a-z0-9_-]{1,45}$' then raise exception 'JLS_QUALIFICATION_NONCE_INVALID';end if;
 perform public.certify_jls_direct4_sources(p_protocol);
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol for update;
 select * into q from public.analysis_jls_sql_qualifications where protocol_id=p.id and nonce=p_nonce;
 if q.id is not null then return q.id;end if;
 insert into public.analysis_jls_sql_qualifications(protocol_id,organization_id,protocol_sha256,run_id,nonce,expires_at)
 values(p.id,p.organization_id,p.sha256,rid,p_nonce,now()+interval '2 hours') returning * into q;
 c=jsonb_build_object('consent_source','technical_qualification_no_spending','qualification_id',q.id,'protocol_sha256',p.sha256,
 'explicit_technical_mock',true,'provider_calls',0,'not_user_authorization',true);
 insert into public.analysis_jls_restaurant_runs(id,protocol_id,organization_id,consent,consent_sha256,expires_at)
 values(rid,p.id,p.organization_id,c,public.jls_restaurant_hash(c),q.expires_at);
 for v in select value from jsonb_array_elements(p.body->'pending') loop
  insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256,identity)
  values(rid,p.organization_id,'jev',v->>'review_id',(v->>'review_id')::uuid,(v->'payload')||jsonb_build_object('questions',p.body#>'{configuration,jev_request_template,questions}'),v->>'request_sha256',v->'identity');
 end loop;
 return q.id;
end $$;
-- Technical fixtures cannot masquerade as real runs, even for a server caller.
create function public.guard_jls_qualification_run() returns trigger language plpgsql set search_path='' as $$
begin
 if new.consent->>'consent_source'='technical_qualification_no_spending' and not exists(
  select 1 from public.analysis_jls_sql_qualifications q where q.run_id=new.id and q.protocol_id=new.protocol_id
  and q.organization_id=new.organization_id and q.id::text=new.consent->>'qualification_id')
 then raise exception 'JLS_UNREGISTERED_QUALIFICATION';end if;return new;
end $$;
create trigger qualification_scope before insert on public.analysis_jls_restaurant_runs for each row execute function public.guard_jls_qualification_run();
do $$declare d text;f regprocedure;begin
 d=pg_get_functiondef('public.jls_restaurant_valid(uuid)'::regprocedure);
 d=replace(d,'r.consent->>''consent_source''=''user_directive_codex_delegation''',
 '(r.consent->>''consent_source''=''user_directive_codex_delegation'' or (public.is_jls_sql_qualification(r.id) and exists(select 1 from public.analysis_jls_sql_qualifications q where q.run_id=r.id and q.expires_at>now())))');execute d;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in('authorize_jls_direct4_historical','authorize_jls_restaurant','authorize_jls_restaurant_pre_ready') loop
  d=pg_get_functiondef(f);
  d=replace(d,'where protocol_id=p.id;','where protocol_id=p.id and consent->>''consent_source'' is distinct from ''technical_qualification_no_spending'';');execute d;
 end loop;
 d=pg_get_functiondef('public.wake_jls_restaurant(uuid)'::regprocedure);
 d=replace(d,'if not public.jls_restaurant_valid(p_run)',
 'if public.is_jls_sql_qualification(p_run) or not public.jls_restaurant_valid(p_run)');execute d;
 -- A mock Sol operation still uses receive/finish and the exact same source
 -- checks. The default paid route never selects it.
 d=pg_get_functiondef('public.save_jls_direct4_ready(jsonb,text)'::regprocedure);
 d=replace(d,'''paid'',r.protocol_id',
 'case when public.is_jls_sql_qualification(r.id) then ''mock'' else ''paid'' end,r.protocol_id');execute d;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in('claim_jls_sol_ready','receive_jls_sol_ready','finish_jls_sol_ready','abort_jls_sol_ready') loop
  d=pg_get_functiondef(f);d=replace(d,'if o.mode=''paid'' then','if o.mode=''paid'' or public.is_jls_sql_qualification(o.run_id) then');execute d;
 end loop;
end $$;
-- Owner screens keep exactly their old real-run history; mocks are visible only
-- through the authenticated technical qualification response/archive.
alter policy restaurant_read on public.analysis_jls_restaurant_runs using(
 consent->>'consent_source' is distinct from 'technical_qualification_no_spending' and exists(
 select 1 from public.organization_members m where m.organization_id=analysis_jls_restaurant_runs.organization_id and m.user_id=(select auth.uid()) and m.role in('owner','admin','manager')));
alter policy restaurant_read on public.analysis_jls_restaurant_tasks using(exists(
 select 1 from public.analysis_jls_restaurant_runs r where r.id=analysis_jls_restaurant_tasks.run_id));
alter policy restaurant_read on public.analysis_jls_restaurant_artifacts using(exists(
 select 1 from public.analysis_jls_restaurant_runs r where r.id=analysis_jls_restaurant_artifacts.run_id));
alter policy receipt_org_read on public.analysis_jls_task_receipts using(exists(
 select 1 from public.analysis_jls_restaurant_runs r where r.id=analysis_jls_task_receipts.run_id));
alter policy dispatch_intent_read on public.analysis_jls_task_dispatch_intents using(exists(
 select 1 from public.analysis_jls_restaurant_runs r where r.id=analysis_jls_task_dispatch_intents.run_id));
alter policy ready_org_read on public.analysis_jls_sol_ready_operations using((mode='paid' or run_id is null) and exists(
 select 1 from public.organization_members m where m.organization_id=analysis_jls_sol_ready_operations.organization_id and m.user_id=(select auth.uid()) and m.role in('owner','admin','manager')));
alter policy ready_org_read on public.analysis_jls_sol_ready_artifacts using(exists(
 select 1 from public.analysis_jls_restaurant_runs r where r.id=analysis_jls_sol_ready_artifacts.source_run_id));
revoke all on function public.is_jls_sql_qualification(uuid),public.start_jls_sql_qualification(uuid,text),public.guard_jls_qualification_run() from public,anon,authenticated;
grant execute on function public.is_jls_sql_qualification(uuid),public.start_jls_sql_qualification(uuid,text) to service_role;
