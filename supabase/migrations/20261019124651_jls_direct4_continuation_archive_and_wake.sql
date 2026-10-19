create or replace function public.check_jls_direct4_continuation(p_operation uuid,p_require_consent boolean default true)
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

create or replace function public.finish_jls_direct4_continuation(p_operation uuid,p_worker text,p_status text,p_body jsonb,p_sha text)
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

create or replace function public.wake_jls_direct4_continuation(p_operation uuid) returns bigint language plpgsql set search_path='' as $$
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


