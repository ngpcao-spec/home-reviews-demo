-- Read-only assertions, run after append-only configuration registration.
begin;
do $$ declare c public.analysis_jev_economy_configurations;old public.analysis_jev_economy_configurations;begin
 select * into strict c from public.analysis_jev_economy_configurations where id='v12_economy_audit_boundaries_v2_1pass_v1';
 select * into strict old from public.analysis_jev_economy_configurations where id='v12_economy_1pass_v1';
 if c.config_sha256<>encode(extensions.digest(public.jev_economy_canonical(c.config),'sha256'),'hex') or
 c.instruction_sha256<>encode(extensions.digest(public.jev_economy_canonical(c.config->'questions'),'sha256'),'hex') or
 c.threshold_sha256<>old.threshold_sha256 or (select count(*) from jsonb_object_keys(c.config->'questions'))<>25 then raise exception 'BOUNDARY_CONFIG_HASH_INVALID';end if;
 if c.config->'questions'->'attentiveness'<>old.config->'questions'->'attentiveness' or c.config->'questions'->'professionalism'<>old.config->'questions'->'professionalism' then raise exception 'V12_SERVICE_DEFINITIONS_CHANGED';end if;
 if c.config->>'paid_enabled'<>'false' or c.config->>'production_enabled'<>'false' or c.config->>'automatic_retry'<>'false' then raise exception 'BOUNDARY_PAID_ENABLED';end if;
 if not (select relrowsecurity from pg_class where oid='public.analysis_jev_economy_configurations'::regclass) or
 has_table_privilege('authenticated','public.analysis_jev_economy_configurations','INSERT,UPDATE,DELETE') then raise exception 'BOUNDARY_CONFIG_ACCESS_INVALID';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.analysis_jev_economy_configurations'::regclass and not tgisinternal and tgenabled='O') then raise exception 'BOUNDARY_IMMUTABILITY_MISSING';end if;
 if (select count(*) from public.analysis_jev_review_cache where configuration_id=c.id)<>0 then raise exception 'UNEXPECTED_NEW_ANALYSIS';end if;
end $$;
rollback;
