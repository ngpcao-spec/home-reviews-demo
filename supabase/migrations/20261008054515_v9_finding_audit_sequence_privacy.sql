-- Keep event counters private as well as the rows; only the Edge service writes events.
revoke all on sequence public.analysis_v9_finding_audit_events_id_seq from public,anon,authenticated;
grant usage,select on sequence public.analysis_v9_finding_audit_events_id_seq to service_role;
