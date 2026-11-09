-- Exact native request reuse. A different wire, selector, or failed-report
-- restart never inherits another request's authorization or receipt.
create table private.shared_restaurant_sol_requests(
 restaurant_id uuid not null references private.shared_restaurants,
 request_sha256 text not null,
 source_run_id uuid not null,
 receipt jsonb,
 receipt_sha256 text,
 primary key(restaurant_id,request_sha256)
);
create table private.shared_restaurant_sol_waiters(
 source_run_id uuid not null,consumer_run_id uuid primary key
);
alter table private.shared_restaurant_sol_requests enable row level security;
alter table private.shared_restaurant_sol_waiters enable row level security;

create function public.reserve_shared_report_sol(p_run uuid,p_sha text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.analysis_jev_batch_runs; restaurant uuid; source private.shared_restaurant_sol_requests; producer public.analysis_jev_batch_runs;
begin
 select * into strict r from public.analysis_jev_batch_runs where id=p_run;
 restaurant:=public.shared_restaurant_for_establishment(r.establishment_id);
 if restaurant is null and public.shared_restaurant_runtime_enabled()
  and exists(select 1 from private.shared_restaurant_establishments where establishment_id=r.establishment_id)
 then return '{"state":"blocked"}';end if;
 -- The existing restart rule removes this pin to require a completely new attempt.
 if restaurant is null or r.shared_jev_version is null then return '{"state":"legacy"}';end if;
 if not r.armed or r.status<>'running' or r.stage<>'sol' or r.envelope->>'request_sha256' is distinct from p_sha then raise exception 'SHARED_SOL_SOURCE_CHANGED';end if;
 perform 1 from private.shared_restaurants where id=restaurant for update;
 select b.* into producer from public.analysis_jev_batch_runs b
  join private.shared_restaurant_establishments l on l.establishment_id=b.establishment_id
  where l.restaurant_id=restaurant and b.status='completed' and b.envelope->>'request_sha256'=p_sha
   and b.sol_receipt->>'request_sha256'=p_sha and b.sol_receipt is not null
  order by b.id limit 1;
 insert into private.shared_restaurant_sol_requests(restaurant_id,request_sha256,source_run_id)
 values(restaurant,p_sha,coalesce(producer.id,p_run)) on conflict do nothing;
 if producer.id is not null then
  update private.shared_restaurant_sol_requests set receipt=producer.sol_receipt,receipt_sha256=producer.sol_receipt_sha256
   where restaurant_id=restaurant and request_sha256=p_sha and source_run_id=producer.id and receipt is null;
 end if;
 select * into strict source from private.shared_restaurant_sol_requests where restaurant_id=restaurant and request_sha256=p_sha;
 if source.source_run_id=p_run then return '{"state":"owner"}';end if;
 if source.receipt is not null then return jsonb_build_object('state','completed','receipt',source.receipt,
  'source_run_id',source.source_run_id,'source_receipt_sha256',source.receipt_sha256);end if;
 select * into producer from public.analysis_jev_batch_runs where id=source.source_run_id;
 if producer.id is null or producer.status<>'running' or not producer.armed then return '{"state":"blocked"}';end if;
 insert into private.shared_restaurant_sol_waiters values(source.source_run_id,p_run) on conflict do nothing;
 return '{"state":"waiting"}';
end $$;

create function private.finish_shared_report_sol() returns trigger
language plpgsql security definer set search_path='' as $$declare w record;begin
 if new.status='completed' and new.sol_receipt is not null then
  update private.shared_restaurant_sol_requests set receipt=new.sol_receipt,receipt_sha256=new.sol_receipt_sha256
   where source_run_id=new.id and receipt is null;
 end if;
 if new.status is distinct from old.status and new.status<>'running' then
  for w in select consumer_run_id from private.shared_restaurant_sol_waiters where source_run_id=new.id loop
   perform public.jev_batch_wake(w.consumer_run_id);
  end loop;
 end if;
 return new;
end $$;
create trigger shared_report_sol_completion after update of status on public.analysis_jev_batch_runs
 for each row execute function private.finish_shared_report_sol();
revoke all on function public.reserve_shared_report_sol(uuid,text),private.finish_shared_report_sol() from public,anon,authenticated;
grant execute on function public.reserve_shared_report_sol(uuid,text) to service_role;
