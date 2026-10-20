-- Database-only technical fixture, always ROLLBACK. No authorization function,
-- HTTP call, scheduler wake or committed run/task. Existing history is read only.
begin;
set local role service_role;
set local jit=off;
do $$declare p public.analysis_jls_restaurant_protocols;pid uuid;rid uuid;tid uuid;x record;v jsonb;b jsonb;wire text;sha text;r jsonb;begin
 select * into p from public.analysis_jls_restaurant_protocols where id='a5a301e5-57ae-477a-b67e-8bbf769b95b8';
 b=p.body||jsonb_build_object('technical_mock_rollback_only',gen_random_uuid());
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256)
 values(p.organization_id,p.establishment_id,p.authority_user_id,b,public.jls_restaurant_hash(b)) returning id into pid;
 insert into public.analysis_jls_restaurant_runs(protocol_id,organization_id,consent,consent_sha256,expires_at,stage,status,worker,lease_until)
 values(pid,p.organization_id,'{"explicit_mock_not_authorization":true}',public.jls_restaurant_hash('{"explicit_mock_not_authorization":true}'),
 now()-interval '1 day','prepare_evidence','running','EXPLICIT_MOCK',now()-interval '1 minute') returning id into rid;
 if public.jls_restaurant_valid(rid) then raise exception 'MOCK_MUST_NOT_AUTHORIZE_DISPATCH';end if;
 for x in select t.*,a.body outcome from public.analysis_jls_restaurant_tasks t join public.analysis_jls_restaurant_artifacts a
 on a.run_id=t.run_id and a.kind='task:'||t.id where t.run_id='eea1bdf1-a2b1-4482-be4e-c6518d4cf214' and t.status='completed' order by t.id limit 8 loop
  insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256,identity,status,request_count,worker,dispatched_at)
  values(rid,p.organization_id,'jev',x.review_id::text,x.review_id,x.request,x.request_sha256,x.identity,'running',1,'EXPLICIT_MOCK',now()) returning id into tid;
  b=x.outcome||'{"explicit_technical_mock_replay":true}';
  v=jsonb_build_object('version','jls-restaurant-receipt-v1','source_kind','provider_outcome','task_id',tid,'worker','EXPLICIT_MOCK',
   'protocol_sha256',public.jls_restaurant_hash((select body from public.analysis_jls_restaurant_protocols where id=pid)),
   'status','completed','body',b,'sha256',public.jls_restaurant_hash(b));
  wire=v::text;sha=encode(extensions.digest(wire,'sha256'),'hex');
  if public.save_jls_restaurant_receipt(tid,'EXPLICIT_MOCK',wire,repeat('0',64)) then raise exception 'BAD_WIRE_HASH';end if;
  if public.save_jls_restaurant_receipt(tid,'WRONG_WORKER',wire,sha) then raise exception 'BAD_WORKER';end if;
  if public.finish_jls_restaurant_task(tid,'EXPLICIT_MOCK','completed',b,public.jls_restaurant_hash(b)) then raise exception 'EXPIRED_LEASE_LEGACY_ACCEPTED';end if;
  if not public.save_jls_restaurant_receipt(tid,'EXPLICIT_MOCK',wire,sha) then raise exception 'RECEIPT_SAVE_FAILED';end if;
  if not public.save_jls_restaurant_receipt(tid,'EXPLICIT_MOCK',wire,sha) then raise exception 'RECEIPT_NOT_IDEMPOTENT';end if;
  v=jsonb_set(v,'{body,request_sha256}',to_jsonb(repeat('0',64)));wire=v::text;
  if public.save_jls_restaurant_receipt(tid,'EXPLICIT_MOCK',wire,encode(extensions.digest(wire,'sha256'),'hex')) then raise exception 'WRONG_REQUEST_ACCEPTED';end if;
 end loop;
 -- Recover database persistence after interruption / expired worker lease, never
 -- request a new provider attempt. The invalid mock consent remains invalid.
 r=public.flush_jls_restaurant_receipts(rid);
 if (r->>'saved')::int<>8 or (select count(*) from public.analysis_jls_restaurant_artifacts where run_id=rid)<>8 then raise exception 'RECEIPT_RESUME_FAILED';end if;
 if (public.flush_jls_restaurant_receipts(rid)->>'saved')::int<>0 then raise exception 'DUPLICATE_FINALIZATION';end if;
 if not public.finish_jls_restaurant_receipt(tid) then raise exception 'COMPLETION_NOT_IDEMPOTENT';end if;
 begin update public.analysis_jls_task_receipts s set wire=s.wire||' ' where task_id=tid;raise exception 'RECEIPT_MUTABLE';
 exception when others then if sqlerrm<>'EVIDENCE_AUDIT_IMMUTABLE' then raise;end if;end;
 begin update public.analysis_jls_restaurant_tasks set status='pending',request_count=0 where id=tid;raise exception 'RETRY_ALLOWED';
 exception when others then if sqlerrm<>'JLS_NO_RETRY' then raise;end if;end;
 if public.jls_restaurant_valid(rid) then raise exception 'PERSISTENCE_CREATED_AUTHORIZATION';end if;
 if (public.flush_jls_restaurant_receipts('eea1bdf1-a2b1-4482-be4e-c6518d4cf214')->>'saved')::int<>0 then raise exception 'HISTORY_REOPENED';end if;
 perform set_config('jls_receipt_test.user',p.authority_user_id::text,true);perform set_config('jls_receipt_test.run',rid::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('jls_receipt_test.user'),true);
do $$begin
 if (select count(*) from public.analysis_jls_task_receipts where run_id=current_setting('jls_receipt_test.run')::uuid)<>8 then raise exception 'OWNER_READ_FAILED';end if;
 if has_table_privilege('authenticated','public.analysis_jls_task_receipts','insert') or
 has_function_privilege('authenticated','public.save_jls_restaurant_receipt(uuid,text,text,text)','execute') or
 has_function_privilege('anon','public.flush_jls_restaurant_receipts(uuid)','execute') then raise exception 'SERVER_WRITE_EXPOSED';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
do $$begin
 if exists(select 1 from public.analysis_jls_task_receipts where run_id=current_setting('jls_receipt_test.run')::uuid) then raise exception 'CROSS_ORG_READ';end if;
end $$;
rollback;
