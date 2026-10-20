-- Certify frozen inputs outside the hot run lock. No consent, run or dispatch.
create table public.analysis_jls_source_certificates(
 protocol_id uuid primary key references public.analysis_jls_restaurant_protocols(id),
 organization_id uuid not null, establishment_id uuid not null, authority_user_id uuid not null,
 protocol_sha256 text not null, body jsonb not null, sha256 text not null,
 created_at timestamptz not null default clock_timestamp()
);
create table public.analysis_jls_source_certificate_refs(
 protocol_id uuid not null references public.analysis_jls_source_certificates(protocol_id),
 source_table text not null, source_id uuid not null, primary key(protocol_id,source_table,source_id)
);
create index jls_certificate_ref_object on public.analysis_jls_source_certificate_refs(source_table,source_id);
create table public.analysis_jls_task_dispatch_intents(
 task_id uuid primary key references public.analysis_jls_restaurant_tasks(id),
 run_id uuid not null, organization_id uuid not null, worker text not null,
 phase text not null check(phase in('jev','luna')), request_sha256 text not null,
 protocol_sha256 text not null, intent_at timestamptz not null default clock_timestamp()
);
create index jls_dispatch_run on public.analysis_jls_task_dispatch_intents(run_id);
do $$declare t text;begin
 foreach t in array array['analysis_jls_source_certificates','analysis_jls_source_certificate_refs','analysis_jls_task_dispatch_intents'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert on public.%I to service_role',t);
  execute format('create trigger immutable before update or delete on public.%I for each row execute function public.pilot_evidence_immutable()',t);
 end loop;
end $$;
grant select on public.analysis_jls_source_certificates,public.analysis_jls_task_dispatch_intents to authenticated;
create policy source_certificate_read on public.analysis_jls_source_certificates for select to authenticated using(exists(
 select 1 from public.organization_members m where m.organization_id=analysis_jls_source_certificates.organization_id and m.user_id=(select auth.uid()) and m.role in('owner','admin','manager')));
create policy dispatch_intent_read on public.analysis_jls_task_dispatch_intents for select to authenticated using(exists(
 select 1 from public.organization_members m where m.organization_id=analysis_jls_task_dispatch_intents.organization_id and m.user_id=(select auth.uid()) and m.role in('owner','admin','manager')));

-- Prevent a late source task/artifact insert as well as updates/deletes. The
-- original running/unknown tasks are NOT made pending or reinterpreted.
-- Read-only integrity trigger: it must see certificate refs independently of
-- the caller's RLS visibility. Not callable by public/authenticated roles.
create function public.guard_jls_certified_source() returns trigger language plpgsql security definer set search_path='' as $$
declare sid uuid;begin
 if tg_op='INSERT' then
  sid=new.run_id;
  perform pg_advisory_xact_lock_shared(hashtextextended('jls-frozen-source:'||sid::text,0));
  if exists(select 1 from public.analysis_jls_source_certificate_refs where source_table='analysis_jls_restaurant_runs' and source_id=sid)
  then raise exception 'JLS_CERTIFIED_SOURCE_IMMUTABLE';end if;
  return new;
 end if;
 if exists(select 1 from public.analysis_jls_source_certificate_refs where source_table=tg_table_name and source_id=old.id)
 then raise exception 'JLS_CERTIFIED_SOURCE_IMMUTABLE';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger certified_source_guard before update or delete on public.historical_report_runs for each row execute function public.guard_jls_certified_source();
create trigger certified_source_guard before update or delete on public.historical_establishment_reports for each row execute function public.guard_jls_certified_source();
create trigger certified_source_guard before update or delete on public.analysis_jls_restaurant_runs for each row execute function public.guard_jls_certified_source();
create trigger certified_source_guard before insert or update or delete on public.analysis_jls_restaurant_tasks for each row execute function public.guard_jls_certified_source();
create trigger certified_source_guard before insert on public.analysis_jls_restaurant_artifacts for each row execute function public.guard_jls_certified_source();

create function public.certify_jls_direct4_sources(p_protocol uuid) returns text
language plpgsql set search_path='' set jit=off as $$
declare p public.analysis_jls_restaurant_protocols;c public.analysis_jls_source_certificates;
 b jsonb;sha text;sid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol;
 if p.id is null or p.body->>'version' not in('jls-direct4-historical-v1','jls-direct4-frozen-corpus-v1') then raise exception 'JLS_CERTIFICATE_PROTOCOL_INVALID';end if;
 select * into c from public.analysis_jls_source_certificates where protocol_id=p.id;
 if c.protocol_id is not null then
  if c.protocol_sha256<>p.sha256 then raise exception 'JLS_CERTIFICATE_CHANGED';end if;return c.sha256;
 end if;
 -- Share locks stabilize the external sources until the certificate + guards
 -- commit. No active continuation run row is locked by this free preparation.
 perform 1 from public.historical_report_runs where id=(p.body#>>'{historical,id}')::uuid for share;
 perform 1 from public.historical_establishment_reports where id=(p.body#>>'{frozen_published_report,id}')::uuid for share;
 if p.body?'continuation' then
  sid=(p.body#>>'{continuation,source_run_id}')::uuid;
  perform 1 from public.analysis_jls_restaurant_runs where id=sid for share;
  perform 1 from public.analysis_jls_restaurant_tasks where run_id=sid order by id for share;
  perform pg_advisory_xact_lock(hashtextextended('jls-frozen-source:'||sid::text,0));
 end if;
 if p.sha256<>public.jls_restaurant_hash(p.body) or not public.check_jls_direct4_historical_sources(p.body)
 then raise exception 'JLS_CERTIFICATE_SOURCE_CHANGED';end if;
 b=jsonb_build_object('version','jls-frozen-source-certificate-v1','protocol_id',p.id,'protocol_sha256',p.sha256,
 'organization_id',p.organization_id,'establishment_id',p.establishment_id,'authority_user_id',p.authority_user_id,
 'source_snapshot_sha256',p.body->>'source_snapshot_sha256','configuration_sha256',p.body->>'configuration_sha256',
 'pending_sha256',p.body->>'pending_sha256','historical',p.body->'historical',
 'source_run_sha256',p.body#>'{continuation,source_run_sha256}',
 'source_tasks_sha256',p.body#>'{continuation,source_tasks_sha256}',
 'source_artifacts_sha256',p.body#>'{continuation,source_artifacts_sha256}',
 'validation_function','check_jls_direct4_historical_sources','source_mutation_guard','guard_jls_certified_source-v1');
 sha=public.jls_restaurant_hash(b);
 insert into public.analysis_jls_source_certificates(protocol_id,organization_id,establishment_id,authority_user_id,protocol_sha256,body,sha256)
 values(p.id,p.organization_id,p.establishment_id,p.authority_user_id,p.sha256,b,sha) on conflict(protocol_id) do nothing;
 insert into public.analysis_jls_source_certificate_refs values
 (p.id,'historical_report_runs',(p.body#>>'{historical,id}')::uuid),
 (p.id,'historical_establishment_reports',(p.body#>>'{frozen_published_report,id}')::uuid) on conflict do nothing;
 if sid is not null then
  insert into public.analysis_jls_source_certificate_refs values(p.id,'analysis_jls_restaurant_runs',sid) on conflict do nothing;
  insert into public.analysis_jls_source_certificate_refs select p.id,'analysis_jls_restaurant_tasks',id from public.analysis_jls_restaurant_tasks where run_id=sid on conflict do nothing;
 end if;
 return sha;
end $$;
create function public.check_jls_source_certificate(p_protocol uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.analysis_jls_source_certificates c
 join public.analysis_jls_restaurant_protocols p on p.id=c.protocol_id
 join public.establishments e on e.id=c.establishment_id and e.organization_id=c.organization_id and e.active
 join public.organization_members m on m.organization_id=c.organization_id and m.user_id=c.authority_user_id and m.role in('owner','admin','manager')
 where c.protocol_id=p_protocol and p.sha256=c.protocol_sha256 and p.organization_id=c.organization_id
 and p.establishment_id=c.establishment_id and p.authority_user_id=c.authority_user_id)
$$;
-- Existing authorization still checks the original GO and exact scope; only the
-- repeated source reconstruction is replaced by a certified immutable binding.
do $$declare d text;begin
 d=pg_get_functiondef('public.authorize_jls_direct4_historical(uuid,jsonb,text)'::regprocedure);
 d=replace(d,'select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol for update;',
 'perform public.certify_jls_direct4_sources(p_protocol); select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol for update;');
 d=replace(d,'public.check_jls_direct4_historical_sources(p.body)','public.check_jls_source_certificate(p.id)');execute d;
 d=pg_get_functiondef('public.claim_jls_direct4_historical_task(uuid,text)'::regprocedure);
 d=replace(d,'public.check_jls_direct4_historical_sources(p.body)',
 '(case when exists(select 1 from public.analysis_jls_source_certificates where protocol_id=p.id) then public.check_jls_source_certificate(p.id) else public.check_jls_direct4_historical_sources(p.body) end)');
 execute d;
 -- These use the same immutable source binding, but keep their own evidence,
 -- request, Luna result and token-certificate checks unchanged.
 foreach d in array array[
  pg_get_functiondef('public.bind_jls_direct4_historical_evidence(uuid,jsonb,text)'::regprocedure),
  pg_get_functiondef('public.check_jls_direct4_historical_ready(jsonb)'::regprocedure)
 ] loop
  execute replace(d,'public.check_jls_direct4_historical_sources(p.body)',
   '(case when exists(select 1 from public.analysis_jls_source_certificates where protocol_id=p.id) then public.check_jls_source_certificate(p.id) else public.check_jls_direct4_historical_sources(p.body) end)');
 end loop;
end $$;
-- Preserve legacy validity for uncertified versions. Certified protocols cannot
-- be changed (trigger); consent and live membership/expiry remain per wake/task.
create or replace function public.jls_restaurant_valid(p_run uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.analysis_jls_restaurant_runs r join public.analysis_jls_restaurant_protocols p on p.id=r.protocol_id
 join public.organization_members m on m.organization_id=r.organization_id and m.user_id=p.authority_user_id and m.role in('owner','admin','manager')
 where r.id=p_run and r.status in('queued','running') and r.expires_at>now() and r.organization_id=p.organization_id
 and case when exists(select 1 from public.analysis_jls_source_certificates where protocol_id=p.id) then public.check_jls_source_certificate(p.id) else p.sha256=public.jls_restaurant_hash(p.body) end
 and r.consent_sha256=public.jls_restaurant_hash(r.consent) and r.consent->>'protocol_sha256'=p.sha256
 and r.consent->>'consent_source'='user_directive_codex_delegation')
$$;
-- An immutable intent immediately before the single transport invocation. It
-- does NOT prove provider receipt, billing or completion. A lost ack stops.
create function public.begin_jls_restaurant_dispatch(p_task uuid,p_worker text,p_request_sha text) returns boolean
language plpgsql set search_path='' set jit=off as $$
declare r public.analysis_jls_restaurant_runs;t public.analysis_jls_restaurant_tasks;p public.analysis_jls_restaurant_protocols;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into t from public.analysis_jls_restaurant_tasks where id=p_task;
 select * into r from public.analysis_jls_restaurant_runs where id=t.run_id for share;
 if not public.jls_restaurant_valid(r.id) or r.worker is distinct from p_worker or r.lease_until<=clock_timestamp() then return false;end if;
 select * into t from public.analysis_jls_restaurant_tasks where id=p_task for update;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if t.status<>'running' or t.request_count<>1 or t.worker is distinct from p_worker or t.phase not in('jev','luna')
 or t.request_sha256 is distinct from p_request_sha or t.organization_id<>r.organization_id then return false;end if;
 insert into public.analysis_jls_task_dispatch_intents(task_id,run_id,organization_id,worker,phase,request_sha256,protocol_sha256)
 values(t.id,t.run_id,t.organization_id,p_worker,t.phase,t.request_sha256,p.sha256) on conflict do nothing;
 return found;
end $$;
revoke all on function public.certify_jls_direct4_sources(uuid),public.check_jls_source_certificate(uuid),public.begin_jls_restaurant_dispatch(uuid,text,text),public.guard_jls_certified_source() from public,anon,authenticated;
grant execute on function public.certify_jls_direct4_sources(uuid),public.check_jls_source_certificate(uuid),public.begin_jls_restaurant_dispatch(uuid,text,text) to service_role;
