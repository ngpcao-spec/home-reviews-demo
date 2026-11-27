begin;
set local lock_timeout='5s';
select pg_advisory_xact_lock(75302143);

-- NULL means no aggregate cap. Keep the configured value until the operator releases it.
alter table private.rainminer_menu_config
 alter column budget_limit_usd drop not null,
 alter column budget_limit_usd drop default,
 drop constraint rainminer_budget_five_dollar_max,
 drop constraint rainminer_menu_config_check,
 add constraint rainminer_menu_config_launch_settings check (
  not launches_enabled or (configured_at is not null and
   (budget_limit_usd is null or budget_limit_usd>=per_run_limit_usd))
 );

create or replace function private.rainminer_launch_block(p_automatic boolean) returns text
language plpgsql stable security definer set search_path='' as $$
declare c private.rainminer_menu_config;
begin
 select * into c from private.rainminer_menu_config where singleton;
 if not found then return 'MENU_CONFIGURATION_MISSING'; end if;
 return case when not c.launches_enabled or c.configured_at is null then 'MENU_LAUNCHES_DISABLED'
  when p_automatic and not c.automatic_enabled then 'MENU_AUTOMATIC_DISABLED'
  when nullif(btrim(c.billing_ceiling_evidence),'') is null then 'MENU_COST_CEILING_UNVERIFIED'
  when c.budget_limit_usd is not null
   and private.rainminer_budget_used()+c.per_run_limit_usd>c.budget_limit_usd then 'MENU_BUDGET_LIMIT'
  end;
end$$;

comment on column private.rainminer_menu_config.budget_limit_usd is
 'Optional cumulative cost cap in USD. NULL disables the aggregate gate. The per-run cap and cost ledger still apply.';
commit;
