-- Sol-only continuation over the existing frozen direct4 contract/worker.
-- No source mutation, consent copy/renewal, automatic launch or supplier call.
create table public.analysis_jls_direct4_continuations(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 source_operation_id uuid not null references public.analysis_jls_sol_ready_operations(id),
 source_archive_id uuid not null references public.analysis_jls_snapshot_preparations(id),
 run_id uuid not null references public.analysis_jls_restaurant_runs(id),
 protocol_id uuid not null references public.analysis_jls_restaurant_protocols(id),
 artifact_id uuid not null references public.analysis_jls_sol_ready_artifacts(id),
 protocol_sha256 text not null,provenance jsonb not null,provenance_sha256 text not null,
 mode text not null check(mode in('mock','paid')),nonce text not null unique,
 phase text not null default 'sol' check(phase in('sol','validate_sol')),
 status text not null default 'queued' check(status in('queued','dispatched','received','validating','completed','needs_review','invalid_output','blocked','billing_uncertain','authorization_expired')),
 request_count int not null default 0 check(request_count in(0,1)),worker text,lease_until timestamptz,
 receipt jsonb,receipt_sha256 text,result jsonb,result_sha256 text,error_code text,
 metrics jsonb not null default '[]',created_at timestamptz not null default now(),completed_at timestamptz);
create unique index direct4_one_paid_continuation on public.analysis_jls_direct4_continuations(source_operation_id) where mode='paid';
create unique index direct4_one_paid_consent on public.analysis_jls_direct4_continuations(protocol_id) where mode='paid';
create index on public.analysis_jls_direct4_continuations(organization_id);
create index on public.analysis_jls_direct4_continuations(run_id);
create index on public.analysis_jls_direct4_continuations(artifact_id);
create index on public.analysis_jls_direct4_continuations(source_archive_id);
alter table public.analysis_jls_direct4_continuations enable row level security;
revoke all on public.analysis_jls_direct4_continuations from public,anon,authenticated;
grant select on public.analysis_jls_direct4_continuations to authenticated;
grant all on public.analysis_jls_direct4_continuations to service_role;
create policy continuation_org_read on public.analysis_jls_direct4_continuations for select to authenticated using(exists(
 select 1 from public.organization_members m where m.organization_id=analysis_jls_direct4_continuations.organization_id
 and m.user_id=(select auth.uid()) and m.role in('owner','admin','manager')));
create trigger immutable_continuation before update or delete on public.analysis_jls_direct4_continuations
 for each row execute function public.jls_ready_operation_guard();

create function public.check_jls_direct4_continuation(p_operation uuid,p_require_consent boolean default true)
returns boolean language plpgsql stable set search_path='' as $$
declare c public.analysis_jls_direct4_continuations;o public.analysis_jls_sol_ready_operations;
 r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;
 a public.analysis_jls_sol_ready_artifacts;d public.analysis_jls_snapshot_preparations;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into c from public.analysis_jls_direct4_continuations where id=p_operation;
 select * into o from public.analysis_jls_sol_ready_operations where id=c.source_operation_id;
 select * into r from public.analysis_jls_restaurant_runs where id=c.run_id;
 select * into p from public.analysis_jls_restaurant_protocols where id=c.protocol_id;
 select * into a from public.analysis_jls_sol_ready_artifacts where id=c.artifact_id;
 select * into d from public.analysis_jls_snapshot_preparations where id=c.source_archive_id;
 return coalesce(c.id is not null and c.provenance_sha256=public.jls_restaurant_hash(c.provenance)
 and c.provenance->>'version'='jls-direct4-sol-continuation-v1'
 and c.provenance->>'source_operation_sha256'=public.jls_restaurant_hash(to_jsonb(o))
 and c.provenance->>'source_run_sha256'=public.jls_restaurant_hash(to_jsonb(r))
 and c.provenance->>'source_archive_sha256'=d.sha256 and d.sha256=public.jls_restaurant_hash(d.body)
 and c.provenance->>'ready_sha256'=a.sha256 and a.sha256=public.jls_restaurant_hash(a.body)
 and c.provenance->>'consent_sha256'=r.consent_sha256 and r.consent_sha256=public.jls_restaurant_hash(r.consent)
 and c.provenance->>'request_sha256'=a.body->>'request_sha256'
 and c.provenance->>'request_raw_sha256'=a.body->>'request_raw_sha256'
 and o.run_id=r.id and o.protocol_id=p.id and r.protocol_id=p.id and o.artifact_id=a.id
 and c.organization_id=r.organization_id and c.organization_id=p.organization_id and c.organization_id=d.organization_id
 and c.organization_id=a.organization_id and c.organization_id=o.organization_id
 and c.protocol_sha256=p.sha256 and p.sha256=public.jls_restaurant_hash(p.body)
 and p.body->>'version'='jls-direct4-execution-v1'
 and p.body->>'preparation_id'='bace8577-e302-42fe-8625-ff9951c1c788'
 and d.body->'run'->>'id'=r.id::text and d.body->'protocol'->>'id'=p.id::text
 and d.body->'sol'->>'operation_id'=o.id::text and d.body->'sol'->'ready'->>'sha256'=a.sha256
 and r.status='blocked' and o.status='blocked' and o.request_count=0 and o.receipt is null and o.result is null
 and r.error_code='JLS_TOKEN_MEASUREMENT_MISSING' and o.error_code='JLS_TOKEN_MEASUREMENT_MISSING'
 and o.lease_until is null and r.lease_until is null
 and not exists(select 1 from public.analysis_jls_restaurant_tasks t where t.run_id=r.id and t.phase='sol' and t.request_count<>0)
 and not exists(select 1 from public.analysis_jls_sol_ready_operations s where s.protocol_id=p.id and s.mode='paid' and s.request_count<>0)
 and r.consent->>'protocol_sha256'=p.sha256 and r.consent->>'preparation_id'=p.body->>'preparation_id'
 and r.consent->>'consent_source'='user_directive_codex_delegation'
 and r.consent->'scope'->>'configuration_sha256'=p.body->>'configuration_sha256'
 and r.consent->'scope'->>'language'='vi' and r.consent->'scope'->>'max_sol_calls'='1'
 and r.consent->'scope'->>'max_jev_calls'='0' and r.consent->'scope'->>'max_luna_calls'='32'
 and r.consent->'scope'->>'apify_calls'='0' and r.consent->'scope'->>'automatic_retry'='false'
 and r.consent->'scope'->>'provider_client_retries'='0'
 and r.consent->'scope'->>'organization_id'=r.organization_id::text
 and r.consent->'scope'->>'establishment_id'=p.establishment_id::text
 and r.expires_at=(r.consent->>'expires_at')::timestamptz
 and (not p_require_consent or r.expires_at>now())
 and exists(select 1 from public.organization_members m where m.organization_id=p.organization_id and m.user_id=p.authority_user_id and m.role in('owner','admin','manager'))
 and public.check_jls_direct4_ready_sources(a.body),false);
end $$;

create function public.create_jls_direct4_continuation(p_source_operation uuid,p_archive uuid,p_code text,p_mode text,p_nonce text)
returns uuid language plpgsql set search_path='' as $$
declare o public.analysis_jls_sol_ready_operations;r public.analysis_jls_restaurant_runs;
 a public.analysis_jls_sol_ready_artifacts;d public.analysis_jls_snapshot_preparations;b jsonb;cid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_mode not in('paid','mock') or p_code!~'^[a-f0-9]{40}$' or p_nonce!~'^[a-zA-Z0-9_-]{1,80}$' then raise exception 'DIRECT4_CONTINUATION_SCOPE_INVALID';end if;
 select * into o from public.analysis_jls_sol_ready_operations where id=p_source_operation for update;
 select * into r from public.analysis_jls_restaurant_runs where id=o.run_id for update;
 if o.id is null then raise exception 'DIRECT4_CONTINUATION_SOURCE_MISSING';end if;
 select id into cid from public.analysis_jls_direct4_continuations where source_operation_id=o.id and mode=p_mode
 and (p_mode='paid' or nonce=p_nonce);
 if cid is not null then return cid;end if;
 select * into a from public.analysis_jls_sol_ready_artifacts where id=o.artifact_id;
 select * into d from public.analysis_jls_snapshot_preparations where id=p_archive;
 b=jsonb_build_object('version','jls-direct4-sol-continuation-v1','source_operation_sha256',public.jls_restaurant_hash(to_jsonb(o)),
 'source_run_sha256',public.jls_restaurant_hash(to_jsonb(r)),'source_archive_sha256',d.sha256,'ready_sha256',a.sha256,
 'consent_sha256',r.consent_sha256,'request_sha256',a.body->>'request_sha256','request_raw_sha256',a.body->>'request_raw_sha256',
 'code_provenance',p_code,'new_consent',false,'max_sol_calls',1,'max_luna_calls',0,'max_jev_calls',0,'max_apify_calls',0,'automatic_retry',false);
 insert into public.analysis_jls_direct4_continuations(organization_id,source_operation_id,source_archive_id,run_id,protocol_id,artifact_id,
 protocol_sha256,provenance,provenance_sha256,mode,nonce) values(o.organization_id,o.id,p_archive,r.id,o.protocol_id,o.artifact_id,
 o.protocol_sha256,b,public.jls_restaurant_hash(b),p_mode,p_nonce) returning id into cid;
 if not public.check_jls_direct4_continuation(cid,true) then raise exception 'DIRECT4_CONTINUATION_SOURCE_OR_CONSENT_INVALID';end if;
 return cid;
end $$;

create function public.claim_jls_direct4_continuation(p_operation uuid,p_worker text)
returns jsonb language plpgsql set search_path='' as $$
declare c public.analysis_jls_direct4_continuations;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into c from public.analysis_jls_direct4_continuations where id=p_operation for update;
 if c.id is null or c.status not in('queued','received','dispatched','validating') or c.lease_until>now() then return null;end if;
 -- Lock the historical source before the continuation's sole durable reservation.
 perform 1 from public.analysis_jls_sol_ready_operations where id=c.source_operation_id for update;
 if c.phase='sol' and c.request_count=1 then
 update public.analysis_jls_direct4_continuations set status='billing_uncertain',error_code='DIRECT4_LOST_ATTEMPT_NO_RETRY',worker=null,lease_until=null where id=c.id;return null;end if;
 if not public.check_jls_direct4_continuation(c.id,c.phase='sol') then raise exception 'DIRECT4_CONTINUATION_SOURCE_OR_CONSENT_INVALID';end if;
 update public.analysis_jls_direct4_continuations set worker=p_worker,lease_until=now()+interval '5 minutes',
 request_count=case when phase='sol' then 1 else request_count end,status=case when phase='sol' then 'dispatched' else 'validating' end
 where id=c.id returning * into c;return to_jsonb(c)-array['provenance','result','metrics'];
end $$;

create function public.receive_jls_direct4_continuation(p_operation uuid,p_worker text,p_body jsonb,p_sha text)
returns boolean language plpgsql set search_path='' as $$
declare c public.analysis_jls_direct4_continuations;a public.analysis_jls_sol_ready_artifacts;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into c from public.analysis_jls_direct4_continuations where id=p_operation for update;
 if c.receipt is not null then return c.receipt_sha256=p_sha;end if;
 select * into a from public.analysis_jls_sol_ready_artifacts where id=c.artifact_id;
 if c.id is null or c.worker is distinct from p_worker or c.status<>'dispatched' or c.request_count<>1
 or p_sha is distinct from public.jls_restaurant_hash(p_body)
 or p_body->>'request_sha256' is distinct from a.body->>'request_sha256'
 or p_body->>'request_raw_sha256' is distinct from a.body->>'request_raw_sha256'
 or (p_body->>'mock')::boolean is distinct from (c.mode='mock')
 or p_body->>'raw_response_text' is not null and p_body->>'raw_response_sha256' is distinct from encode(extensions.digest(p_body->>'raw_response_text','sha256'),'hex') then return false;end if;
 update public.analysis_jls_direct4_continuations set receipt=p_body,receipt_sha256=p_sha,phase='validate_sol',
 status=case when p_body->>'raw_response_text' is null then 'billing_uncertain' else 'received' end,
 worker=null,lease_until=null,error_code=p_body->>'error_code' where id=c.id;return true;
end $$;

create function public.finish_jls_direct4_continuation(p_operation uuid,p_worker text,p_status text,p_body jsonb,p_sha text)
returns boolean language plpgsql set search_path='' as $$
declare c public.analysis_jls_direct4_continuations;d public.analysis_jls_snapshot_preparations;archive_body jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into c from public.analysis_jls_direct4_continuations where id=p_operation for update;
 if c.result is not null then return c.result_sha256=p_sha;end if;
 if c.id is null or c.worker is distinct from p_worker or c.status<>'validating' or c.request_count<>1 or c.receipt is null
 or p_status not in('completed','needs_review','invalid_output','billing_uncertain')
 or p_sha is distinct from public.jls_restaurant_hash(p_body)
 or p_body->>'receipt_sha256' is distinct from c.receipt_sha256
 or p_body->>'raw_response_sha256' is distinct from c.receipt->>'raw_response_sha256' then return false;end if;
 select * into d from public.analysis_jls_snapshot_preparations where id=c.source_archive_id;
 archive_body=jsonb_build_object('version','jls-direct4-sol-continuation-v1','continuation_id',c.id,'mode',c.mode,
 'source_archive_id',d.id,'source_archive_sha256',d.sha256,'source_run_id',c.run_id,
 'source_operation_id',c.source_operation_id,'ready_artifact_id',c.artifact_id,'provenance',c.provenance,
 'provenance_sha256',c.provenance_sha256,'receipt',c.receipt,'receipt_sha256',c.receipt_sha256,
 'result',p_body,'result_sha256',p_sha,'status',p_status,'sol_attempts',1,'new_luna_calls',0,'new_jev_calls',0,
 'new_apify_calls',0,'automatic_retry',false,'production_enabled',false,'human_validated',false);
 perform public.save_jls_snapshot_preparation(d.protocol_id,'direct4_sol_continuation_'||c.id,archive_body,public.jls_restaurant_hash(archive_body));
 update public.analysis_jls_direct4_continuations set result=p_body,result_sha256=p_sha,status=p_status,
 worker=null,lease_until=null,completed_at=now(),error_code=p_body->>'error_code' where id=c.id;return true;
end $$;

create function public.abort_jls_direct4_continuation(p_operation uuid,p_worker text,p_error text)
returns void language plpgsql set search_path='' as $$
declare c public.analysis_jls_direct4_continuations;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into c from public.analysis_jls_direct4_continuations where id=p_operation for update;
 if c.id is null or c.status not in('queued','dispatched','received','validating') or c.worker is not null and c.worker<>p_worker then return;end if;
 update public.analysis_jls_direct4_continuations set status=case when request_count=1 and phase='sol' then 'billing_uncertain' else 'blocked' end,
 worker=null,lease_until=null,error_code=p_error where id=c.id;
end $$;
revoke all on function public.check_jls_direct4_continuation(uuid,boolean),public.create_jls_direct4_continuation(uuid,uuid,text,text,text),
 public.claim_jls_direct4_continuation(uuid,text),public.receive_jls_direct4_continuation(uuid,text,jsonb,text),
 public.finish_jls_direct4_continuation(uuid,text,text,jsonb,text),public.abort_jls_direct4_continuation(uuid,text,text) from public,anon,authenticated;
grant execute on function public.check_jls_direct4_continuation(uuid,boolean),public.create_jls_direct4_continuation(uuid,uuid,text,text,text),
 public.claim_jls_direct4_continuation(uuid,text),public.receive_jls_direct4_continuation(uuid,text,jsonb,text),
 public.finish_jls_direct4_continuation(uuid,text,text,jsonb,text),public.abort_jls_direct4_continuation(uuid,text,text) to service_role;

create function public.wake_jls_direct4_continuation(p_operation uuid) returns bigint language plpgsql set search_path='' as $$
declare c public.analysis_jls_direct4_continuations;rid bigint;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into c from public.analysis_jls_direct4_continuations where id=p_operation;
 if c.id is null or c.mode<>'paid' or c.status not in('queued','dispatched','received','validating') then return null;end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-jls-restaurant',
 headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',
 (select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
 body:=jsonb_build_object('continuation_id',c.id),timeout_milliseconds:=1000) into rid;return rid;
end $$;
revoke all on function public.wake_jls_direct4_continuation(uuid) from public,anon,authenticated;
grant execute on function public.wake_jls_direct4_continuation(uuid) to service_role;
-- Empty at deployment. Only an explicit delegated create can add a paid row.
select cron.schedule('jls-direct4-continuation-wake','* * * * *',$job$
 set local role service_role;
 select public.wake_jls_direct4_continuation(id) from public.analysis_jls_direct4_continuations
 where mode='paid' and status in('queued','dispatched','received','validating');
$job$);


