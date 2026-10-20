-- Real deployed RPCs; no provider. All preparation/fixture writes rollback.
begin;
set local role service_role;
set local jit=off;
do $$declare a uuid='f162a09b-a717-4b5e-ab0c-3dc2b34a81b1';
 sid uuid='ad64447b-cc9e-4f22-852b-63f43a1564f0';pid uuid;sha text;b jsonb;bad jsonb;begin
 sha=public.record_jls_nondispatch_adjudication(a);
 if public.record_jls_nondispatch_adjudication(a)<>sha then raise exception 'NON_IDEMPOTENT';end if;
 pid=public.prepare_jls_adjudicated_continuation(sid,'a308563b175e7b7924a2af3551c0cd490a559e54');
 if public.prepare_jls_adjudicated_continuation(sid,'a308563b175e7b7924a2af3551c0cd490a559e54')<>pid then raise exception 'PROTOCOL_NON_IDEMPOTENT';end if;
 select body into b from public.analysis_jls_restaurant_protocols where id=pid;
 if not public.check_jls_direct4_historical_sources(b) or jsonb_array_length(b->'pending')<>51
 or jsonb_array_length(b#>'{continuation,reused}')<>36 or jsonb_array_length(b#>'{continuation,missing}')<>4
 or jsonb_array_length(b#>'{continuation,adjudication,entries}')<>5 then raise exception 'BAD_PARTITION';end if;
 bad=jsonb_set(b,'{continuation,adjudication,entries,0,classification}','"unknown"');
 if public.check_jls_direct4_historical_sources(bad) then raise exception 'UNKNOWN_ACCEPTED';end if;
 bad=jsonb_set(b,'{continuation,adjudication,source_run_id}','"eea1bdf1-a2b1-4482-be4e-c6518d4cf214"');
 if public.check_jls_direct4_historical_sources(bad) then raise exception 'WRONG_RUN_ACCEPTED';end if;
 bad=jsonb_set(b,'{continuation,adjudication,proof_sha256}',to_jsonb(repeat('0',64)));
 if public.check_jls_direct4_historical_sources(bad) then raise exception 'WRONG_PROOF_ACCEPTED';end if;
 bad=jsonb_set(b,'{continuation,missing,0,result}','{}');
 if public.check_jls_direct4_historical_sources(bad) then raise exception 'OLD_UNKNOWN_RECLASSIFIED';end if;
 begin
  perform public.prepare_jls_adjudicated_continuation(sid,repeat('1',40));
  raise exception 'DUPLICATE_PROTOCOL_ACCEPTED';
 exception when unique_violation then null;end;
 begin
  update public.analysis_jls_restaurant_tasks set request_count=0,status='pending' where id='905fb59e-e6a5-4235-acd3-8c04e0466748';
  raise exception 'HISTORY_RESET';
 exception when others then if sqlerrm<>'JLS_CERTIFIED_SOURCE_IMMUTABLE' then raise;end if;end;
 begin
  update public.analysis_jls_nondispatch_adjudications set sha256=repeat('0',64) where source_run_id=sid;
  raise exception 'ADJUDICATION_MUTABLE';
 exception when others then if sqlerrm<>'EVIDENCE_AUDIT_IMMUTABLE' then raise;end if;end;
 if exists(select 1 from public.analysis_jls_restaurant_runs where protocol_id=pid) then raise exception 'UNEXPECTED_RUN';end if;
 perform set_config('jls.adjudication.test',jsonb_build_object('passed',true,'pending',51,'reused',36,'excluded',4,
 'not_started_adjudicated',5,'provider_calls',0,'paid_runs',0)::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d6e79d9c-72cd-40d2-a945-0452b268a783","role":"authenticated"}',true);
do $$begin
 if not exists(select 1 from public.analysis_jls_nondispatch_adjudications where source_run_id='ad64447b-cc9e-4f22-852b-63f43a1564f0') then raise exception 'OWNER_READ_DENIED';end if;
 begin perform public.record_jls_nondispatch_adjudication('f162a09b-a717-4b5e-ab0c-3dc2b34a81b1');
 raise exception 'CLIENT_WRITE_ALLOWED';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$begin if exists(select 1 from public.analysis_jls_nondispatch_adjudications) then raise exception 'CROSS_ORG_READ';end if;end $$;
select current_setting('jls.adjudication.test')::jsonb result;
rollback;
