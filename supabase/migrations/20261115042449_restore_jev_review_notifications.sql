-- Alerts describe a newly received negative review, not a generated reply.
-- They must not depend on which AI pipeline processes that review.
create table private.review_notification_runtime (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default true,
 activated_at timestamptz not null default clock_timestamp()
);
insert into private.review_notification_runtime(singleton) values(true);
create table private.review_notification_deliveries (
 notification_id uuid primary key references public.notifications(id) on delete cascade,
 state text not null default 'pending' check(state in ('pending','processing','sent','skipped','failed','unknown')),
 claim_id uuid,
 claimed_at timestamptz,
 finished_at timestamptz,
 receipt jsonb,
 created_at timestamptz not null default clock_timestamp()
);
create index review_notification_pending on private.review_notification_deliveries(created_at,notification_id) where state='pending';
create index review_notification_processing on private.review_notification_deliveries(claimed_at) where state='processing';
alter table private.review_notification_runtime enable row level security;
alter table private.review_notification_deliveries enable row level security;
revoke all on private.review_notification_runtime,private.review_notification_deliveries from public,anon,authenticated;
grant all on private.review_notification_runtime,private.review_notification_deliveries to service_role;

create function private.enqueue_negative_review_notification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.historical_import or not (
   new.rating between 1 and 3 or new.rating=4 and new.has_negative_feedback is true
 ) or not exists(select 1 from private.review_notification_runtime where enabled and new.created_at>=activated_at)
 then return new; end if;
 -- Updates of original text/translations and replays do not manufacture new alerts.
 if tg_op='UPDATE' and not (new.rating=4 and new.has_negative_feedback is true and old.has_negative_feedback is distinct from true)
 then return new; end if;
 with inserted as (
  insert into public.notifications(organization_id,user_id,review_id,establishment_id,type,title,body)
  select new.organization_id,m.user_id,new.id,new.establishment_id,
   case when new.rating=4 then 'four_star_attention' else 'new_negative_review' end,
   case when p.preferred_language='vi' then 'Đánh giá mới ' else 'Nouvel avis ' end||new.rating||'★ — '||e.name,
   case when p.preferred_language='vi' then 'Một đánh giá mới cần bạn chú ý.' else 'Un nouvel avis nécessite votre attention.' end
  from public.establishments e
  join public.organization_members m on m.organization_id=e.organization_id and m.created_at<=new.created_at
  left join public.profiles p on p.user_id=m.user_id
  where e.id=new.establishment_id and e.organization_id=new.organization_id and e.active
  on conflict(user_id,review_id,type) do nothing returning id
 ) insert into private.review_notification_deliveries(notification_id) select id from inserted;
 return new;
end $$;
revoke all on function private.enqueue_negative_review_notification() from public,anon,authenticated;
create trigger reviews_negative_notification_insert after insert on public.reviews
for each row execute function private.enqueue_negative_review_notification();
create trigger reviews_negative_notification_update after update of has_negative_feedback on public.reviews
for each row execute function private.enqueue_negative_review_notification();

-- Claims are committed BEFORE external delivery. Unknown outcomes never retry.
create function public.claim_review_notification_delivery(p_claim uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare picked uuid; answer jsonb;
begin
 if current_user not in ('service_role','postgres') then raise exception 'FORBIDDEN'; end if;
 if p_claim is null then raise exception 'CLAIM_REQUIRED'; end if;
 if not exists(select 1 from private.review_notification_runtime where enabled) then return null; end if;
 with expired as (
  update private.review_notification_deliveries set state='unknown',finished_at=clock_timestamp(),receipt='{"error":"DELIVERY_OUTCOME_UNKNOWN"}'
  where state='processing' and claimed_at<clock_timestamp()-interval '5 minutes' returning notification_id
 ) update public.notifications n set push_status='failed',push_error='DELIVERY_OUTCOME_UNKNOWN'
   from expired e where n.id=e.notification_id;
 -- Membership, subscription and read state are rechecked at delivery time.
 with skipped as (
  update private.review_notification_deliveries d set state='skipped',finished_at=clock_timestamp(),receipt='{"reason":"RECIPIENT_NO_LONGER_ELIGIBLE"}'
  from public.notifications n where n.id=d.notification_id and d.state='pending' and (
   n.read_at is not null or not exists(select 1 from public.organization_members m where m.organization_id=n.organization_id and m.user_id=n.user_id)
   or not exists(select 1 from public.establishments e where e.id=n.establishment_id and e.organization_id=n.organization_id and e.active)
  ) returning d.notification_id
 ) update public.notifications n set push_status='skipped',push_error=null from skipped s where n.id=s.notification_id;
 select notification_id into picked from private.review_notification_deliveries
 where state='pending' order by created_at,notification_id limit 1 for update skip locked;
 if picked is null then return null; end if;
 update private.review_notification_deliveries set state='processing',claim_id=p_claim,claimed_at=clock_timestamp() where notification_id=picked;
 select jsonb_build_object('id',n.id,'user_id',n.user_id,'review_id',n.review_id,'title',n.title,'body',n.body) into answer
 from public.notifications n where n.id=picked;
 return answer;
end $$;

create function public.finish_review_notification_delivery(p_id uuid,p_claim uuid,p_state text,p_receipt jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if current_user not in ('service_role','postgres') then raise exception 'FORBIDDEN'; end if;
 if p_state not in ('sent','skipped','failed','unknown') or p_state is null then raise exception 'INVALID_DELIVERY_STATE'; end if;
 update private.review_notification_deliveries set state=p_state,receipt=p_receipt,finished_at=clock_timestamp()
 where notification_id=p_id and claim_id=p_claim and state='processing';
 if not found then return false; end if;
 update public.notifications set push_status=case when p_state='unknown' then 'failed' else p_state end,
 push_error=case when p_state='unknown' then 'DELIVERY_OUTCOME_UNKNOWN'
   when p_state='failed' or coalesce((p_receipt->>'failed')::int,0)>0 then 'PUSH_DELIVERY_PARTIAL_OR_FAILED' else null end,
 pushed_at=case when p_state='sent' then clock_timestamp() else null end where id=p_id;
 return true;
end $$;
revoke all on function public.claim_review_notification_delivery(uuid),public.finish_review_notification_delivery(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_review_notification_delivery(uuid),public.finish_review_notification_delivery(uuid,uuid,text,jsonb) to service_role;

-- Same scheduler credential as the existing workers. No secret enters source/logs.
create function private.dispatch_review_notifications() returns bigint
language plpgsql security definer set search_path='' as $$
declare request_id bigint;
begin
 if not exists(select 1 from private.review_notification_runtime where enabled)
 or not exists(select 1 from private.review_notification_deliveries where state in ('pending','processing')) then return null; end if;
 select net.http_post(
  url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-review-notifications',
  headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',
   (select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
  body:='{}'::jsonb,timeout_milliseconds:=60000) into request_id;
 return request_id;
end $$;
revoke all on function private.dispatch_review_notifications() from public,anon,authenticated;
select cron.schedule('home-reviews-review-notifications-v1','* * * * *','select private.dispatch_review_notifications();');
