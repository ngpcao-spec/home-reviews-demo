-- FOR SHARE requires update privileges on the policy table. Take the same
-- lock inside a trigger with narrowly scoped privileges, leaving RLS in force
-- for the notification update itself.
create function private.guard_notification_update()
returns trigger language plpgsql security definer set search_path='' as $$
declare p public.review_corpus_policy;
begin
  select * into p from public.review_corpus_policy where id for share;
  if p.paused then raise exception 'RETENTION_TRANSITION_ACTIVE'; end if;
  if 'public.notifications'=any(p.retired_relations) then raise exception 'REPORT_PIPELINE_RETIRED'; end if;
  return null;
end $$;
revoke all on function private.guard_notification_update() from public,anon,authenticated;

drop trigger retention_transition_guard on public.notifications;
create trigger retention_transition_guard before insert or delete on public.notifications
for each statement execute function public.retention_write_guard();
create trigger retention_notification_update_guard before update on public.notifications
for each statement execute function private.guard_notification_update();
