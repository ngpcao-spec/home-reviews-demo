-- Measured on a real 610-review /526-text frozen corpus. Expensive checks run
-- once, and cache joins are materialized in preceding migrations. Bound only
-- these free preparation/queue RPC transactions to 20s (not all roles/queries).
-- No provider request can run inside either transaction.
alter function public.prepare_current_v2_protocol(uuid,jsonb,text) set statement_timeout='20s';
alter function public.start_parallel_report(jsonb,text,uuid) set statement_timeout='20s';
notify pgrst,'reload schema';
