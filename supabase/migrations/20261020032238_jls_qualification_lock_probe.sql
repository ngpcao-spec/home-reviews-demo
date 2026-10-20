-- Bounded lock injection ONLY on registered technical fixtures, never history.
create function public.hold_jls_sql_qualification_lock(p_qualification uuid) returns jsonb
language plpgsql set search_path='' as $$
declare q public.analysis_jls_sql_qualifications;at timestamptz=clock_timestamp();begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into q from public.analysis_jls_sql_qualifications where id=p_qualification and expires_at>now();
 if q.id is null or not public.is_jls_sql_qualification(q.run_id) then raise exception 'JLS_SQL_QUALIFICATION_INVALID';end if;
 perform set_config('application_name','jls_qualification_lock_v1',true);
 perform 1 from public.analysis_jls_restaurant_runs where id=q.run_id for update;
 perform pg_sleep(2);
 return jsonb_build_object('backend_pid',pg_backend_pid(),'held_ms',extract(epoch from clock_timestamp()-at)*1000,'provider_calls',0);
end $$;
create function public.inspect_jls_sql_qualification_locks(p_qualification uuid) returns jsonb
language plpgsql set search_path='' as $$begin
 if current_user<>'service_role' or not exists(select 1 from public.analysis_jls_sql_qualifications where id=p_qualification and expires_at>now()) then raise exception 'FORBIDDEN';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('pid',a.pid,'application_name',a.application_name,'wait_event_type',a.wait_event_type,'wait_event',a.wait_event,'blockers',pg_blocking_pids(a.pid))),'[]'::jsonb)
 from pg_stat_activity a where a.application_name='jls_qualification_lock_v1' or exists(select 1 from pg_stat_activity h where h.application_name='jls_qualification_lock_v1' and h.pid=any(pg_blocking_pids(a.pid))));
end $$;
revoke all on function public.hold_jls_sql_qualification_lock(uuid),public.inspect_jls_sql_qualification_locks(uuid) from public,anon,authenticated;
grant execute on function public.hold_jls_sql_qualification_lock(uuid),public.inspect_jls_sql_qualification_locks(uuid) to service_role;
