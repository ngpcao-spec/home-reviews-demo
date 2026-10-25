-- Display only. No backfill, provider invocation, import or report generation.
set local lock_timeout='5s';
set local statement_timeout='30s';
create table private.review_display_runtime(singleton boolean primary key default true check(singleton),enabled boolean not null default false,last_dispatch_at timestamptz,request_id bigint,wake_error text);
insert into private.review_display_runtime(singleton) values(true);
revoke all on private.review_display_runtime from public,anon,authenticated,service_role;

create function private.review_display_source(p_original text,p_text text) returns text language sql immutable set search_path='' as $$select coalesce(nullif(p_original,''),p_text,'')$$;
create function private.review_display_hash(p_text text) returns text language sql immutable set search_path='' as $$select encode(extensions.digest(p_text,'sha256'),'hex')$$;
revoke all on function private.review_display_source(text,text),private.review_display_hash(text) from public,anon,authenticated;

create table public.review_display_texts(
 review_id uuid not null references public.reviews(id) on delete cascade,
 language text not null check(language in('fr','vi')),
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 status text not null default 'queued' check(status in('queued','processing','translated','original','failed','unknown')),
 translated_text text,source_language text,language_origin text check(language_origin in('provider','detected')),
 priority integer not null default 0,worker_id text,lease_until timestamptz,attempt_id uuid,
 error_code text,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 primary key(review_id,language,source_sha256),
 check(status<>'translated' or nullif(btrim(translated_text),'') is not null)
);
create index review_display_queue on public.review_display_texts(priority desc,created_at) where status in('queued','processing');
alter table public.review_display_texts enable row level security;
revoke all on public.review_display_texts from public,anon,authenticated;
grant select on public.review_display_texts to authenticated;
grant all on public.review_display_texts to service_role;
create policy display_texts_read on public.review_display_texts for select to authenticated using(exists(select 1 from public.reviews r where r.id=review_id and (select private.is_org_member(r.organization_id))));

-- Content-free durable receipts survive a purge. The review pointer is removed.
create table private.review_display_receipts(
 id uuid primary key,review_id uuid references public.reviews(id) on delete set null,
 language text not null,source_sha256 text not null,status text not null,worker_id text not null,
 started_at timestamptz not null default clock_timestamp(),finished_at timestamptz,
 model text,usage jsonb,provider_response_id text,error_code text,
 unique(review_id,language,source_sha256)
);
revoke all on private.review_display_receipts from public,anon,authenticated,service_role;

create function private.queue_review_display(p_review uuid,p_language text,p_priority integer default 0) returns void
language plpgsql security definer set search_path='' as $$
declare r public.reviews;s text;begin
 if p_language not in('fr','vi') then raise exception 'DISPLAY_LANGUAGE_INVALID';end if;
 select * into r from public.reviews where id=p_review;
 if not found or public.review_usable_text(r.original_text,r.text) is null then return;end if;
 s=private.review_display_hash(private.review_display_source(r.original_text,r.text));
 insert into public.review_display_texts(review_id,language,source_sha256,priority) values(r.id,p_language,s,p_priority)
 on conflict(review_id,language,source_sha256) do update set priority=greatest(review_display_texts.priority,excluded.priority);
end $$;
revoke all on function private.queue_review_display(uuid,text,integer) from public,anon,authenticated,service_role;

create function private.refresh_review_display() returns trigger language plpgsql security definer set search_path='' as $$
declare l text;begin
 if tg_op='UPDATE' and private.review_display_source(old.original_text,old.text)=private.review_display_source(new.original_text,new.text) then
  if old.original_language is not distinct from new.original_language then return new;end if;
  delete from public.review_display_texts where review_id=new.id and language_origin='provider' and status='original';
 else delete from public.review_display_texts where review_id=new.id;
 end if;
 for l in select distinct p.preferred_language from public.profiles p join public.organization_members m on m.user_id=p.user_id
  where m.organization_id=new.organization_id and p.preferred_language in('fr','vi') loop
  perform private.queue_review_display(new.id,l,0);
 end loop;
 return new;
end $$;
revoke all on function private.refresh_review_display() from public,anon,authenticated,service_role;
create trigger review_display_source_changed after insert or update of original_text,text,original_language on public.reviews
 for each row execute function private.refresh_review_display();

create function private.dispatch_review_display_queue() returns bigint language plpgsql security definer set search_path='' as $$
declare c private.review_display_runtime;rid bigint;begin
 select * into c from private.review_display_runtime where singleton for update;
 if not c.enabled or c.last_dispatch_at>clock_timestamp()-interval '1 second' or exists(select 1 from public.review_corpus_policy where paused)
  or (select count(*) from public.review_display_texts where status='processing' and lease_until>clock_timestamp())>=2
  or not exists(select 1 from public.review_display_texts where status='queued' or status='processing' and lease_until<clock_timestamp()) then return null;end if;
 begin
  select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-review-display',
   headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
   body:='{}',timeout_milliseconds:=180000) into rid;
  update private.review_display_runtime set last_dispatch_at=clock_timestamp(),request_id=rid,wake_error=null where singleton;
 exception when others then update private.review_display_runtime set wake_error='DISPLAY_WAKE_FAILED_CRON_RECOVERY' where singleton;end;
 return rid;
end $$;
revoke all on function private.dispatch_review_display_queue() from public,anon,authenticated,service_role;
create function public.wake_review_display_queue() returns bigint language sql security definer set search_path='' as $$select private.dispatch_review_display_queue()$$;
revoke all on function public.wake_review_display_queue() from public,anon,authenticated;
grant execute on function public.wake_review_display_queue() to service_role;

create function private.read_review_display(p_reviews uuid[],p_prepare boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l text;rid uuid;result jsonb;begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED';end if;
 if cardinality(p_reviews)>30 or cardinality(p_reviews)<1 then raise exception 'DISPLAY_BATCH_INVALID';end if;
 select preferred_language into l from public.profiles where user_id=auth.uid();
 if l is null or l not in('fr','vi') then raise exception 'PREFERRED_LANGUAGE_REQUIRED';end if;
 if exists(select 1 from unnest(p_reviews) i where not exists(select 1 from public.reviews r where r.id=i and private.is_org_member(r.organization_id))) then raise exception 'FORBIDDEN';end if;
 if p_prepare then
  foreach rid in array p_reviews loop perform private.queue_review_display(rid,l,1);end loop;
  perform private.dispatch_review_display_queue();
 end if;
 select jsonb_agg(jsonb_build_object('review_id',r.id,'language',l,'original_text',private.review_display_source(r.original_text,r.text),
  'source_sha256',private.review_display_hash(private.review_display_source(r.original_text,r.text)),
  'status',case when public.review_usable_text(r.original_text,r.text) is null then 'original' else coalesce(t.status,'missing') end,
  'translated_text',case when t.status='translated' then t.translated_text end,'source_language',t.source_language,'error_code',t.error_code)) into result
 from public.reviews r left join public.review_display_texts t on t.review_id=r.id and t.language=l and t.source_sha256=private.review_display_hash(private.review_display_source(r.original_text,r.text)) where r.id=any(p_reviews);
 return coalesce(result,'[]');
end $$;
revoke all on function private.read_review_display(uuid[],boolean) from public,anon,service_role;
grant execute on function private.read_review_display(uuid[],boolean) to authenticated;
create function public.read_review_display(p_reviews uuid[],p_prepare boolean default true) returns jsonb
language sql security invoker set search_path='' as $$select private.read_review_display(p_reviews,p_prepare)$$;
revoke all on function public.read_review_display(uuid[],boolean) from public,anon;
grant execute on function public.read_review_display(uuid[],boolean) to authenticated;

create function public.claim_review_display(p_worker text) returns setof jsonb language plpgsql security definer set search_path='' as $$
declare capacity integer;begin
 if not exists(select 1 from private.review_display_runtime where enabled) or exists(select 1 from public.review_corpus_policy where paused) then return;end if;
 perform pg_advisory_xact_lock(hashtextextended('review-display-claims',0));
 update private.review_display_receipts a set status='unknown',error_code='TRANSLATION_OUTCOME_UNKNOWN' from public.review_display_texts t where a.id=t.attempt_id and t.status='processing' and t.lease_until<clock_timestamp();
 update public.review_display_texts set status=case when attempt_id is null then 'queued' else 'unknown' end,error_code=case when attempt_id is not null then 'TRANSLATION_OUTCOME_UNKNOWN' end,worker_id=case when attempt_id is null then null else worker_id end,lease_until=null where status='processing' and lease_until<clock_timestamp();
 select greatest(2-count(*)::integer,0) into capacity from public.review_display_texts where status='processing';
 return query with candidates as(select review_id,language,source_sha256 from public.review_display_texts where status='queued' order by priority desc,created_at,review_id,language for update skip locked limit capacity),
 claimed as(update public.review_display_texts t set status='processing',worker_id=p_worker,lease_until=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp() from candidates c where t.review_id=c.review_id and t.language=c.language and t.source_sha256=c.source_sha256 returning t.*)
 select to_jsonb(t)||jsonb_build_object('original_text',private.review_display_source(r.original_text,r.text),
 'original_language',coalesce(d.source_language,r.original_language),'source_provider',case when d.source_language is not null then 'detected' else r.source_provider end,
 'provider_translation',(select tr.translated_text from public.review_translations tr join public.review_provider_payloads raw on raw.review_id=tr.review_id
  where tr.review_id=r.id and tr.language=t.language and raw.raw_payload->>'text'=private.review_display_source(r.original_text,r.text)
   and raw.raw_payload->>'textTranslated'=tr.translated_text and lower(split_part(raw.raw_payload->>'translatedLanguage','-',1))=t.language limit 1))
 from claimed t join public.reviews r on r.id=t.review_id left join lateral(select source_language from public.review_display_texts x where x.review_id=t.review_id and x.source_sha256=t.source_sha256 and x.language_origin='detected' and x.status in('original','translated') limit 1)d on true;
end $$;
revoke all on function public.claim_review_display(text) from public,anon,authenticated;
grant execute on function public.claim_review_display(text) to service_role;

create function public.reserve_review_display(p_review uuid,p_language text,p_sha text,p_worker text) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid=gen_random_uuid();j public.review_display_texts;begin
 select t.* into j from public.review_display_texts t join public.reviews r on r.id=t.review_id where t.review_id=p_review and t.language=p_language and t.source_sha256=p_sha and t.status='processing' and t.worker_id=p_worker and t.lease_until>clock_timestamp() and t.attempt_id is null and private.review_display_hash(private.review_display_source(r.original_text,r.text))=p_sha for update of t;
 if not found then return null;end if;
 insert into private.review_display_receipts(id,review_id,language,source_sha256,status,worker_id) values(a,p_review,p_language,p_sha,'started',p_worker) on conflict(review_id,language,source_sha256) do nothing;
 if not found then update public.review_display_texts set status='unknown',error_code='TRANSLATION_PREVIOUS_ATTEMPT_EXISTS',lease_until=null where review_id=p_review and language=p_language and source_sha256=p_sha;return null;end if;
 update public.review_display_texts set attempt_id=a where review_id=p_review and language=p_language and source_sha256=p_sha;return a;
end $$;
revoke all on function public.reserve_review_display(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_review_display(uuid,text,text,text) to service_role;

create function public.finish_review_display(p_review uuid,p_language text,p_sha text,p_worker text,p_result jsonb,p_attempt uuid default null) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.review_display_texts;a uuid;begin
 if p_result->>'status' not in('translated','original','failed','unknown') or octet_length(p_result::text)>200000 then raise exception 'DISPLAY_RESULT_INVALID';end if;
 select * into j from public.review_display_texts where review_id=p_review and language=p_language and source_sha256=p_sha and worker_id=p_worker and status in('processing','unknown') for update;
 select id into a from private.review_display_receipts where id=p_attempt and worker_id=p_worker and language=p_language and source_sha256=p_sha;
 if a is not null then update private.review_display_receipts set status=p_result->>'status',finished_at=clock_timestamp(),model=left(p_result->>'model',100),usage=p_result->'usage',provider_response_id=left(p_result->>'provider_response_id',200),error_code=left(p_result->>'error_code',100) where id=a;end if;
 if j.review_id is null or not exists(select 1 from public.reviews r where r.id=p_review and private.review_display_hash(private.review_display_source(r.original_text,r.text))=p_sha) then return false;end if;
 update public.review_display_texts set status=p_result->>'status',translated_text=case when p_result->>'status'='translated' then p_result->>'translated_text' end,source_language=p_result->>'source_language',language_origin=p_result->>'language_origin',error_code=left(p_result->>'error_code',100),lease_until=null,updated_at=clock_timestamp() where review_id=p_review and language=p_language and source_sha256=p_sha;return true;
end $$;
revoke all on function public.finish_review_display(uuid,text,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.finish_review_display(uuid,text,text,text,jsonb,uuid) to service_role;

select cron.schedule('home-reviews-display-translations-v1','* * * * *',$cron$select private.dispatch_review_display_queue();$cron$);
-- The worker is deployed first. No existing review is enqueued by installation.
update private.review_display_runtime set enabled=true where singleton;
