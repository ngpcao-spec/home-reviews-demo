-- Completion is durable and atomic with the import; no historical backfill.
alter table public.notifications alter column review_id drop not null;
alter table public.notifications add column import_job_id uuid
  references public.initial_import_jobs(id) on delete cascade;
create unique index notifications_import_recipient_unique
  on public.notifications(import_job_id, user_id) where import_job_id is not null;

-- Clients can acknowledge notifications, never forge dispatch state/content.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update(read_at) on public.notifications to authenticated;

create table private.import_completion_pushes (
  notification_id uuid primary key references public.notifications(id) on delete cascade,
  attempts integer not null default 0,
  lease_token uuid,
  available_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table private.import_completion_pushes enable row level security;
revoke all on private.import_completion_pushes from public, anon, authenticated;
grant all on private.import_completion_pushes to service_role;
create index import_completion_pushes_pending_idx
  on private.import_completion_pushes(available_at) where finished_at is null;

create function private.notify_initial_import_completed()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_name text; v_language text; v_notification uuid;
begin
  select e.name, coalesce(p.preferred_language, new.preferred_language)
  into v_name, v_language
  from public.establishments e
  join public.organization_members m on m.organization_id=e.organization_id and m.user_id=new.user_id
  left join public.profiles p on p.user_id=new.user_id
  where e.id=new.establishment_id and e.organization_id=new.organization_id;
  if not found then return new; end if;
  insert into public.notifications(organization_id,user_id,establishment_id,import_job_id,type,title,body)
  values(new.organization_id,new.user_id,new.establishment_id,new.id,'initial_import_completed',
    case when v_language='vi' then 'Nhập dữ liệu hoàn tất' else 'Import terminé' end,
    v_name || E'\n' || case when v_language='vi'
      then 'Đã nhập ' || new.reviews_inserted || ' đánh giá'
      else new.reviews_inserted || ' avis importés' end)
  on conflict(import_job_id,user_id) where import_job_id is not null do nothing
  returning id into v_notification;
  if v_notification is not null then
    insert into private.import_completion_pushes(notification_id) values(v_notification);
  end if;
  return new;
end $$;
revoke all on function private.notify_initial_import_completed() from public,anon,authenticated;
create trigger initial_import_completion_notification
after update of status on public.initial_import_jobs
for each row when (new.status='completed' and old.status is distinct from 'completed')
execute function private.notify_initial_import_completed();

-- The existing server cron drains this outbox, including after a worker restart.
create function public.claim_import_completion_pushes()
returns table(notification_id uuid,lease_token uuid,user_id uuid,establishment_id uuid,title text,body text)
language sql security definer set search_path='' as $$
  with exhausted as (
    update private.import_completion_pushes q set finished_at=now(),lease_token=null
    where q.finished_at is null and q.available_at<=now() and q.attempts>=3
    returning q.notification_id
  ), marked_failed as (
    update public.notifications n set push_status='failed',push_error='PUSH_DELIVERY_UNCONFIRMED'
    from exhausted e where n.id=e.notification_id
  ), candidates as (
    select q.notification_id from private.import_completion_pushes q
    where q.finished_at is null and q.available_at<=now() and q.attempts<3
    order by q.available_at limit 10 for update skip locked
  ), claimed as (
    update private.import_completion_pushes q
    set attempts=q.attempts+1,lease_token=gen_random_uuid(),available_at=now()+interval '5 minutes'
    from candidates c where q.notification_id=c.notification_id
    returning q.notification_id,q.lease_token
  )
  select c.notification_id,c.lease_token,n.user_id,n.establishment_id,n.title,n.body
  from claimed c join public.notifications n on n.id=c.notification_id;
$$;
revoke all on function public.claim_import_completion_pushes() from public,anon,authenticated;
grant execute on function public.claim_import_completion_pushes() to service_role;

create function public.finish_import_completion_push(p_notification_id uuid,p_lease_token uuid,p_status text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_attempts integer;
begin
  if p_status is null or p_status not in ('sent','skipped','failed') then raise exception 'INVALID_PUSH_STATUS'; end if;
  update private.import_completion_pushes q
  set finished_at=case when p_status<>'failed' or q.attempts>=3 then now() else null end,
      available_at=now()+interval '5 minutes',lease_token=null
  where q.notification_id=p_notification_id and q.lease_token=p_lease_token
    and q.finished_at is null
  returning q.attempts into v_attempts;
  if not found then return false; end if;
  update public.notifications set push_status=p_status,
    push_error=case when p_status='failed' then 'PUSH_DELIVERY_FAILED' else null end,
    pushed_at=case when p_status='sent' then now() else null end
  where id=p_notification_id;
  return true;
end $$;
revoke all on function public.finish_import_completion_push(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_import_completion_push(uuid,uuid,text) to service_role;
