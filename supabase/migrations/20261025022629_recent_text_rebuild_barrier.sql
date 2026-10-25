-- Temporary admission gate: workers may finish the authorized reconstruction,
-- while concurrent user requests cannot expand its bounded queue.
create table private.retention_rebuild_requests(request_id uuid primary key);
alter table private.retention_rebuild_requests enable row level security;
revoke all on private.retention_rebuild_requests from public,anon,authenticated,service_role;
grant select on private.retention_rebuild_requests to service_role;
do $$declare d text;a text;begin
 d=pg_get_functiondef('public.enqueue_current_report(uuid,uuid,uuid,text,uuid,text,integer)'::regprocedure);
 a='if exists(select 1 from public.review_corpus_policy where paused) then raise exception ''RETENTION_TRANSITION_ACTIVE'';end if;';
 if position(a in d)=0 then raise exception 'RETENTION_ENQUEUE_GATE_CHANGED';end if;
 d=replace(d,a,a||E'\n if exists(select 1 from private.retention_rebuild_requests) and not exists(select 1 from private.retention_rebuild_requests where request_id=p_request) then raise exception ''RETENTION_TRANSITION_ACTIVE'';end if;');execute d;
end $$;
