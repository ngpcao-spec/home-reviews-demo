create table private.shared_restaurant_analysis_waiters(
 operation_key text not null references private.shared_restaurant_operations(key),
 review_id uuid not null references public.reviews(id) on delete cascade,
 language text not null check(language in ('fr','vi')),
 worker_url text not null check(worker_url ~ '^https://[^/]+/functions/v1/analyze-review$'),
 dispatched_at timestamptz,
 primary key(operation_key,review_id,language)
);
alter table private.shared_restaurant_analysis_waiters enable row level security;

create function private.dispatch_shared_analysis_waiters(p_key text) returns void
language plpgsql security definer set search_path='' as $$
declare w record;secret text;
begin
 if not exists(select 1 from private.shared_restaurant_operations where key=p_key and state='completed') then return; end if;
 select c.secret into secret from public.ai_webhook_config c where singleton;
 if secret is null then return; end if;
 for w in select * from private.shared_restaurant_analysis_waiters where operation_key=p_key and dispatched_at is null for update skip locked loop
  -- This callback is cached-only. Even a changed source/config cannot start a provider.
  perform net.http_post(url:=w.worker_url,headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-webhook',secret),
   body:=jsonb_build_object('review_id',w.review_id,'shared_operation_key',w.operation_key,'shared_language',w.language));
  update private.shared_restaurant_analysis_waiters set dispatched_at=now()
   where operation_key=w.operation_key and review_id=w.review_id and language=w.language;
 end loop;
end $$;
create function public.defer_shared_review_analysis(p_key text,p_review uuid,p_language text,p_worker_url text)
returns void language plpgsql security definer set search_path='' as $$begin
 if not public.shared_restaurant_runtime_enabled() then raise exception 'SHARED_RUNTIME_DISABLED'; end if;
 if not exists(select 1 from public.reviews r where r.id=p_review and public.shared_restaurant_for_establishment(r.establishment_id) is not null)
 then raise exception 'SHARED_REVIEW_UNAVAILABLE'; end if;
 insert into private.shared_restaurant_analysis_waiters values(p_key,p_review,p_language,p_worker_url,null) on conflict do nothing;
 perform private.dispatch_shared_analysis_waiters(p_key);
end $$;
create function private.finish_shared_analysis_waiters() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if new.state='completed' then perform private.dispatch_shared_analysis_waiters(new.key); end if;return new;
end $$;
create trigger shared_analysis_waiters_ready after update of state on private.shared_restaurant_operations
 for each row execute function private.finish_shared_analysis_waiters();
revoke all on function public.defer_shared_review_analysis(text,uuid,text,text),private.dispatch_shared_analysis_waiters(text),
 private.finish_shared_analysis_waiters() from public,anon,authenticated;
grant execute on function public.defer_shared_review_analysis(text,uuid,text,text) to service_role;
