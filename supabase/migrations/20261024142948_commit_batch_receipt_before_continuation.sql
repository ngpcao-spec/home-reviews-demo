-- Commit the native receipt before any aggregate refresh or scheduler work.
-- This changes no classification, provider reservation, retry or history.
CREATE OR REPLACE FUNCTION public.jev_batch_receive(p_task uuid, p_worker text, p_receipt jsonb, p_sha text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare t public.analysis_jev_batch_tasks;begin
 if current_user<>'service_role' or public.jls_restaurant_hash(p_receipt) is distinct from p_sha then raise exception 'FORBIDDEN';end if;
 select * into t from public.analysis_jev_batch_tasks where id=p_task for update;
 if t.receipt is not null then return t.receipt_sha256=p_sha;end if;
 if t.status not in('reserved','unknown') or t.worker is distinct from p_worker or t.request_count<>1 or p_receipt->>'request_sha256' is distinct from t.request_sha256 then return false;end if;
 update public.analysis_jev_batch_tasks set receipt=p_receipt,receipt_sha256=p_sha,
  status=case when p_receipt->>'raw_response_text' is null then 'unknown' else 'received' end,
  error_code=case when p_receipt->>'raw_response_text' is null then 'BATCH_OUTCOME_UNKNOWN_NO_RETRY' else null end,lease_until=null,
  input_tokens=case when p_receipt#>>'{usage,input_tokens}' ~ '^[0-9]+$' then (p_receipt#>>'{usage,input_tokens}')::bigint else null end,
  output_tokens=case when p_receipt#>>'{usage,output_tokens}' ~ '^[0-9]+$' then (p_receipt#>>'{usage,output_tokens}')::bigint else null end,
  duration_ms=case when jsonb_typeof(p_receipt->'duration_ms')='number' then (p_receipt->>'duration_ms')::double precision else null end,
  served_model=p_receipt->>'served_model',provider_request_id=p_receipt->>'provider_request_id' where id=t.id;
 return true;
end $function$;

create function public.jev_batch_continue_received(p_task uuid,p_sha text) returns boolean
language plpgsql set search_path='' set jit='off' as $$
declare t public.analysis_jev_batch_tasks;other uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into t from public.analysis_jev_batch_tasks where id=p_task;
 if t.receipt is null or t.receipt_sha256 is distinct from p_sha then return false;end if;
 perform public.jev_batch_refresh_usage(t.run_id);
 perform public.jev_batch_wake(t.run_id);
 select id into other from public.analysis_jev_batch_runs br where current_source_run_id is not null and id<>t.run_id and armed and status='running' and expires_at>now()
  and exists(select 1 from public.analysis_jev_batch_tasks bt where bt.run_id=br.id and bt.status='pending' and bt.request_count=0) order by created_at limit 1;
 if other is not null then perform public.jev_batch_wake(other);end if;return true;
end $$;
revoke all on function public.jev_batch_continue_received(uuid,text) from public,anon,authenticated;
grant execute on function public.jev_batch_continue_received(uuid,text) to service_role;

