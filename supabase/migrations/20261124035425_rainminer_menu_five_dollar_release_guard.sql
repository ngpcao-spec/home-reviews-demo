-- Preparation only: no paid start, no backfill, no reset of cost reservations.
begin;
set local lock_timeout='5s';
select pg_advisory_xact_lock(75302143);
-- Keep the provider's exact numeric amount, including sub-micro-dollar costs.
alter table public.rainminer_menu_jobs alter column actual_cost_usd type numeric;

alter table private.rainminer_menu_config
 alter column budget_limit_usd set default 5,
 add constraint rainminer_budget_five_dollar_max check(budget_limit_usd<=5),
 add column billing_ceiling_evidence text,
 add column first_test_job_id uuid references public.rainminer_menu_jobs(id);
-- Only configure an untouched, disabled installation. Existing commitments and
-- lower configured budgets survive; an incompatible >$5 config rejects migration.
update private.rainminer_menu_config set budget_limit_usd=5
 where not launches_enabled and not automatic_enabled and configured_at is null and budget_limit_usd=0;

create or replace function private.rainminer_launch_block(p_automatic boolean) returns text
language plpgsql stable security definer set search_path='' as $$
declare c private.rainminer_menu_config;
begin
 select * into c from private.rainminer_menu_config where singleton;
 if not found then return 'MENU_CONFIGURATION_MISSING'; end if;
 return case when not c.launches_enabled or c.configured_at is null then 'MENU_LAUNCHES_DISABLED'
  when p_automatic and not c.automatic_enabled then 'MENU_AUTOMATIC_DISABLED'
  when nullif(btrim(c.billing_ceiling_evidence),'') is null then 'MENU_COST_CEILING_UNVERIFIED'
  when private.rainminer_budget_used()+c.per_run_limit_usd>c.budget_limit_usd then 'MENU_BUDGET_LIMIT'
  end;
end$$;

-- Restrict a future explicitly authorized first test to one immutable job ID.
-- Patching asserted anchors avoids duplicating the validated queue machinery.
do $$
declare definition text; old_text text; new_text text;
begin
 definition:=pg_get_functiondef('public.claim_rainminer_menu()'::regprocedure);
 old_text:='select * into j from public.rainminer_menu_jobs where status=''queued''';
 new_text:=old_text||E'\n   and ((select first_test_job_id from private.rainminer_menu_config where singleton) is null\n    or id=(select first_test_job_id from private.rainminer_menu_config where singleton))';
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'MENU_CLAIM_PATCH_ANCHOR_MISSING'; end if;
 execute replace(definition,old_text,new_text);

 definition:=pg_get_functiondef('public.authorize_rainminer_start(uuid,timestamptz,jsonb,jsonb)'::regprocedure);
 old_text:='if not private.rainminer_live_target(j.id) then blocked:=''MENU_NO_ACTIVE_TARGET''; end if;';
 new_text:=old_text||E'\n if exists(select 1 from private.rainminer_menu_config where singleton and first_test_job_id is not null and first_test_job_id<>j.id) then blocked:=''MENU_SINGLE_TEST_ONLY''; end if;';
 if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'MENU_AUTHORIZE_PATCH_ANCHOR_MISSING'; end if;
 execute replace(definition,old_text,new_text);
end$$;

-- Defend the ledger at its write boundary too. Missing/contradictory receipts
-- keep the reservation; a cost above its cap stops all new paid starts.
create or replace function public.checkpoint_rainminer_menu(p_job uuid,p_lease timestamptz,p_values jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer; j public.rainminer_menu_jobs; cost numeric; valid_receipt boolean;
begin
 perform pg_advisory_xact_lock(75302143);
 select * into j from public.rainminer_menu_jobs where id=p_job and lease_until=p_lease
  and status in ('starting','running') for update;
 if j.id is null then return false; end if;
 if p_values->>'status' is null or p_values->>'status' not in ('running','completed','failed','unknown') then raise exception 'MENU_INVALID_CHECKPOINT'; end if;
 valid_receipt:=coalesce(p_values#>>'{run_receipt,id}'=coalesce(p_values->>'run_id',j.run_id)
  and p_values#>>'{run_receipt,actId}'='8GGZ9N7j2JhqnQ3oT'
  and p_values#>>'{run_receipt,status}' in ('SUCCEEDED','FAILED','ABORTED','TIMED-OUT')
  and p_values#>>'{run_receipt,pricingInfo,pricingModel}'='PAY_PER_EVENT'
  and coalesce(p_values#>>'{run_receipt,pricingInfo,isPPEPlatformUsagePaidByUser}','false')='false'
  and p_values#>>'{run_receipt,options,isMaxTotalChargeUsdSetByUser}'='true'
  and case when jsonb_typeof(p_values#>'{run_receipt,options,maxTotalChargeUsd}')='number'
   then (p_values#>>'{run_receipt,options,maxTotalChargeUsd}')::numeric end=coalesce(j.reserved_cost_usd,0.5)
  and jsonb_typeof(p_values#>'{run_receipt,usageTotalUsd}')='number'
  and jsonb_typeof(p_values->'actual_cost_usd')='number'
  and p_values#>>'{run_receipt,usageTotalUsd}'=p_values->>'actual_cost_usd',false);
 if valid_receipt and p_values->>'status' in ('completed','failed') then
  cost:=(p_values->>'actual_cost_usd')::numeric;
  if cost<0 then cost:=null; end if;
 end if;
 if cost>coalesce(j.reserved_cost_usd,0.5) then
  update private.rainminer_menu_config set launches_enabled=false,automatic_enabled=false,billing_ceiling_evidence=null where singleton;
 end if;
 update public.rainminer_menu_jobs set status=p_values->>'status',run_id=coalesce(p_values->>'run_id',run_id),
  raw=coalesce(p_values->'raw',raw),result=coalesce(p_values->'result',result),
  run_receipt=coalesce(p_values->'run_receipt',run_receipt),actual_cost_usd=coalesce(cost,actual_cost_usd),
  retrieved_at=coalesce((p_values->>'retrieved_at')::timestamptz,retrieved_at),
  finished_at=case when p_values->>'status' in ('completed','failed') then now() else finished_at end,
  error_code=case when cost>coalesce(j.reserved_cost_usd,0.5) then 'MENU_COST_CEILING_BREACHED' else p_values->>'error_code' end,
  lease_until=null,updated_at=now()
 where id=j.id;
 get diagnostics changed=row_count;
 return changed=1;
end$$;
revoke all on function private.rainminer_launch_block(boolean) from public,anon,authenticated,service_role;
revoke all on function public.checkpoint_rainminer_menu(uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint_rainminer_menu(uuid,timestamptz,jsonb) to service_role;
comment on column private.rainminer_menu_config.billing_ceiling_evidence is
 'Operator evidence of an enforced total ceiling including post-run dataset/transfer/storage charges, not just PPE events. NULL blocks new paid starts. Never use an estimate or a synthetic test as production evidence.';
comment on column private.rainminer_menu_config.first_test_job_id is
 'Optional single-job launch gate. Reads of accepted runs continue. Keep the ID after the first test; changing or clearing it requires new operator authorization.';
commit;
