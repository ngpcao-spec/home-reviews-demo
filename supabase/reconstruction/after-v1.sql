-- Reconstruction only, after home_reviews_v1; never part of deployable migrations.
-- Exact catalog definitions read from ihuztjkblywzjdruusdj on 2026-11-11.
-- No credential rows, application rows or secrets were read or copied.
do $$begin
 if current_setting('home.reconstruction',true) is distinct from 'empty-ci-v1'
  or exists(select 1 from public.organizations) or exists(select 1 from public.establishments)
 then raise exception 'EMPTY_RECONSTRUCTION_ONLY';end if;
end $$;
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;
revoke all on function public.rls_auto_enable() from public,anon,authenticated;
grant execute on function public.rls_auto_enable() to service_role;
-- Hosted platform event trigger, confirmed in pg_event_trigger (not an app stub).
create event trigger ensure_rls on ddl_command_end
 when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
 execute function public.rls_auto_enable();
