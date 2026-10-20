-- Same RPC functions/role, actual frozen protocol; all fixture writes rollback.
begin;
set local role service_role;
set local statement_timeout='8s';
set local jit=off;
do $$declare q uuid;rid uuid;w text='EXPLICIT_SQL_MOCK';t jsonb;v jsonb;b jsonb;wire text;at timestamptz;
 durations jsonb='[]';pid uuid='eaf70922-ef49-4872-a211-9b4f3206aef7';begin
 if not public.check_jls_source_certificate(pid) then raise exception 'MISSING_CERTIFICATE';end if;
 q=public.start_jls_sql_qualification(pid,'rollback_sql_regression');
 if public.start_jls_sql_qualification(pid,'rollback_sql_regression')<>q then raise exception 'QUALIFICATION_NOT_IDEMPOTENT';end if;
 select run_id into rid from public.analysis_jls_sql_qualifications where id=q;
 if not public.jls_restaurant_valid(rid) or public.wake_jls_restaurant(rid) is not null then raise exception 'MOCK_PAID_WAKE';end if;
 if not public.claim_jls_restaurant_tick(rid,w) or public.claim_jls_restaurant_tick(rid,'OTHER') then raise exception 'LEASE_NOT_EXCLUSIVE';end if;
 for i in 1..51 loop
  at=clock_timestamp();t=public.claim_jls_restaurant_task(rid,w);
  durations=durations||jsonb_build_array(extract(epoch from clock_timestamp()-at)*1000);
  if t is null or t->>'request_count'<>'1' then raise exception 'CLAIM_FAILED';end if;
  if not public.begin_jls_restaurant_dispatch((t->>'id')::uuid,w,t->>'request_sha256') or
   public.begin_jls_restaurant_dispatch((t->>'id')::uuid,w,t->>'request_sha256') then raise exception 'DISPATCH_NOT_ONCE';end if;
  b=jsonb_build_object('phase','jev','request_sha256',t->>'request_sha256','raw_response_text','{"EXPLICIT_TECHNICAL_MOCK":true}',
   'raw_response_sha256',encode(extensions.digest('{"EXPLICIT_TECHNICAL_MOCK":true}','sha256'),'hex'),
   'provider_fetch_invoked',true,'provider_response_received',true,'explicit_technical_mock',true);
  v=jsonb_build_object('version','jls-restaurant-receipt-v1','source_kind','provider_outcome','task_id',t->>'id','worker',w,
   'protocol_sha256',(select protocol_sha256 from public.analysis_jls_sql_qualifications where id=q),'status','completed','body',b,'sha256',public.jls_restaurant_hash(b));
  wire=v::text;
  if not public.save_jls_restaurant_receipt((t->>'id')::uuid,w,wire,encode(extensions.digest(wire,'sha256'),'hex')) then raise exception 'SAVE_FAILED';end if;
  if not public.finish_jls_restaurant_receipt((t->>'id')::uuid) or not public.finish_jls_restaurant_receipt((t->>'id')::uuid) then raise exception 'FINISH_FAILED';end if;
 end loop;
 if public.claim_jls_restaurant_task(rid,w) is not null then raise exception 'CAP_EXCEEDED';end if;
 if not public.stage_jls_restaurant(rid,w,'prepare_evidence','[]') then raise exception 'STAGE_FAILED';end if;
 begin update public.analysis_jls_restaurant_tasks set request_count=0,status='pending' where id=(t->>'id')::uuid;
 raise exception 'RETRY_ACCEPTED';exception when others then if sqlerrm<>'JLS_NO_RETRY' then raise;end if;end;
 begin update public.analysis_jls_restaurant_tasks set error_code='CHANGED' where id='cda8b1fa-95c1-48f5-a750-1f398e9c3952';
 raise exception 'SOURCE_MUTABLE';exception when others then if sqlerrm<>'JLS_CERTIFIED_SOURCE_IMMUTABLE' then raise;end if;end;
 begin update public.analysis_jls_source_certificates set protocol_sha256=repeat('0',64) where protocol_id=pid;
 raise exception 'CERTIFICATE_MUTABLE';exception when others then if sqlerrm<>'EVIDENCE_AUDIT_IMMUTABLE' then raise;end if;end;
 perform set_config('jls.cert.test',jsonb_build_object('claims',51,'claim_sql_ms',durations,'provider_calls',0,'passed',true)::text,true);
end $$;
select current_setting('jls.cert.test')::jsonb result;
rollback;
