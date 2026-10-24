-- Supabase default privileges grant ALL on new tables to service_role.
-- This audit only permits inserts and reads, including for the server role.
revoke all on public.report_generation_abandonments from service_role;
grant select,insert on public.report_generation_abandonments to service_role;
