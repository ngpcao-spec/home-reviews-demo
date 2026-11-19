-- Additive history, initialized ONLY from rows still present at deployment.
-- The active review window, provider calls, cursors and report rules stay unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
lock table public.reviews,public.review_translations,private.shared_restaurant_reviews,
 private.shared_restaurant_review_translations in share row exclusive mode;

create table private.review_history_scopes(
 scope_kind text not null check(scope_kind in('local','shared')), scope_id uuid not null,
 started_at timestamptz not null default transaction_timestamp(),
 primary key(scope_kind,scope_id)
);
create table private.review_history(
 scope_kind text not null,scope_id uuid not null,external_id text not null check(btrim(external_id)<>''),
 source_review_id uuid, published_at timestamptz,rating integer not null check(rating between 1 and 5),
 original_text text not null,public_payload jsonb not null,
 observed_at timestamptz not null,first_saved_at timestamptz not null default transaction_timestamp(),
 primary key(scope_kind,scope_id,external_id),
 foreign key(scope_kind,scope_id) references private.review_history_scopes
);
create index review_history_period on private.review_history(scope_kind,scope_id,published_at desc,external_id desc);
create table private.review_history_translations(
 scope_kind text not null,scope_id uuid not null,external_id text not null,
 language text not null check(language in('fr','vi','en')),source_text_sha256 text not null,
 translated_text text not null,observed_at timestamptz not null default transaction_timestamp(),
 primary key(scope_kind,scope_id,external_id,language,source_text_sha256),
 foreign key(scope_kind,scope_id,external_id) references private.review_history
);
alter table private.review_history_scopes enable row level security;
alter table private.review_history enable row level security;
alter table private.review_history_translations enable row level security;
revoke all on private.review_history_scopes,private.review_history,private.review_history_translations from public,anon,authenticated,service_role;

-- Deliberate allowlist shared with the existing catalogue; no workflow, notes,
-- notifications, reply drafts or AI suggestions can enter this read corpus.
create function private.save_review_history(p_kind text,p_scope uuid,p_row jsonb,p_translations jsonb default '[]')
returns void language plpgsql security definer set search_path='' as $$
declare sid text:=nullif(btrim(p_row->>'external_review_id'),''); pub timestamptz;
 stars integer; original text; observed timestamptz; t jsonb; sha text;
begin
 if p_kind not in('local','shared') or p_scope is null or sid is null then raise exception 'HISTORY_SCOPE_INVALID';end if;
 pub:=nullif(p_row->>'published_at','')::timestamptz; stars:=(p_row->>'rating')::integer;
 -- Preserve a seed row even when its date is unusable. The common statistics
 -- reader excludes undated/future rows explicitly instead of silently losing it.
 if stars is null or stars not between 1 and 5 then return;end if;
 original:=coalesce(nullif(p_row->>'original_text',''),p_row->>'text','');
 observed:=coalesce(nullif(p_row->>'provider_scraped_at','')::timestamptz,nullif(p_row->>'updated_at','')::timestamptz,transaction_timestamp());
 -- Independent history mutex: never acquire a business restaurant/corpus lock
 -- from this hook. Serializes overlapping multi-row language observations.
 if p_kind='shared' then perform pg_advisory_xact_lock(hashtextextended('review-history:'||p_scope::text,0));end if;
 insert into private.review_history_scopes(scope_kind,scope_id) values(p_kind,p_scope) on conflict do nothing;
 insert into private.review_history(scope_kind,scope_id,external_id,source_review_id,published_at,rating,original_text,public_payload,observed_at)
 values(p_kind,p_scope,sid,case when p_kind='local' then nullif(p_row->>'id','')::uuid end,pub,stars,original,
   private.shared_review_public_fields(p_row),observed)
 on conflict(scope_kind,scope_id,external_id) do update set
  published_at=least(review_history.published_at,excluded.published_at),
  source_review_id=coalesce(review_history.source_review_id,excluded.source_review_id),
  rating=case when excluded.observed_at>=review_history.observed_at then excluded.rating else review_history.rating end,
  original_text=case when excluded.observed_at>=review_history.observed_at then excluded.original_text else review_history.original_text end,
  public_payload=case when excluded.observed_at>=review_history.observed_at then excluded.public_payload else review_history.public_payload end,
  observed_at=greatest(review_history.observed_at,excluded.observed_at);
 sha:=encode(extensions.digest(original,'sha256'),'hex');
 for t in select value from jsonb_array_elements(coalesce(p_translations,'[]')) loop
  -- An explicit incompatible hash must never be forced to match the current text.
  if t->>'language' in('fr','vi','en') and nullif(btrim(t->>'translated_text'),'') is not null
    and coalesce(t->>'source_text_sha256',t->>'original_text_sha256',sha)=sha then
   insert into private.review_history_translations(scope_kind,scope_id,external_id,language,source_text_sha256,translated_text,observed_at)
   values(p_kind,p_scope,sid,t->>'language',sha,t->>'translated_text',observed)
   on conflict(scope_kind,scope_id,external_id,language,source_text_sha256) do update set
    translated_text=excluded.translated_text,observed_at=excluded.observed_at
   where excluded.observed_at>=review_history_translations.observed_at;
  end if;
 end loop;
end $$;

create function private.retain_review_history_bundle(p_establishment uuid,p_organization uuid,p_bundle jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare b jsonb;v jsonb;restaurant uuid;seen_date timestamptz;
begin
 if not exists(select 1 from public.establishments where id=p_establishment and organization_id=p_organization)
  or jsonb_typeof(p_bundle) is distinct from 'array' or jsonb_array_length(p_bundle)>500 then raise exception 'HISTORY_SCOPE_INVALID';end if;
 restaurant:=public.shared_restaurant_for_establishment(p_establishment);
 -- The same deterministic duplicate choice as the existing ingestion function.
 for b in with items as(select value,ordinality from jsonb_array_elements(p_bundle) with ordinality),ranked as(
  select value,row_number() over(partition by btrim(value#>>'{row,external_review_id}') order by
   (public.review_usable_text(value#>>'{row,original_text}',value#>>'{row,text}') is not null) desc,ordinality desc) rn,
   min(nullif(value#>>'{row,published_at}','')::timestamptz) over(partition by btrim(value#>>'{row,external_review_id}')) first_date from items)
  select jsonb_set(value,'{row,published_at}',coalesce(to_jsonb(first_date),'null')) from ranked where rn=1 order by btrim(value#>>'{row,external_review_id}') loop
  v:=b->'row';
  if (v->>'establishment_id')::uuid is distinct from p_establishment or (v->>'organization_id')::uuid is distinct from p_organization then raise exception 'HISTORY_SCOPE_INVALID';end if;
  select k.first_published_at into seen_date from private.review_seen_keys k where k.establishment_id=p_establishment
    and k.external_key_sha256=encode(extensions.digest(btrim(v->>'external_review_id'),'sha256'),'hex');
  if seen_date is not null then v:=jsonb_set(v,'{published_at}',to_jsonb(least(seen_date,(v->>'published_at')::timestamptz)));end if;
  perform private.save_review_history('local',p_establishment,v,coalesce(b->'translations','[]'));
  if restaurant is not null then perform private.save_review_history('shared',restaurant,v,coalesce(b->'translations','[]'));end if;
 end loop;
end $$;

create function private.retain_incremental_review_history(p_establishment uuid,p_organization uuid,p_bundle jsonb,p_result jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare history jsonb:=coalesce(p_result->'history_bundle',p_bundle);
begin
 if jsonb_typeof(history) is distinct from 'array' or jsonb_array_length(history)>150
  or jsonb_array_length(history)>(p_result->>'unique')::integer
  or exists(select 1 from jsonb_array_elements(history) x where
   nullif(btrim(x#>>'{row,external_review_id}'),'') is null
   or not coalesce(p_result->'external_ids' ? (x#>>'{row,external_review_id}'),false)) then
  raise exception 'HISTORY_INCREMENTAL_RESULT_INVALID';end if;
 perform private.retain_review_history_bundle(p_establishment,p_organization,history);
end $$;

create function private.retain_review_history_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare v jsonb; t jsonb; kind text; scope uuid;
begin
 if tg_table_schema='public' then
  kind:='local';
  if tg_table_name='reviews' then v:=to_jsonb(new);t:='[]';
  else
   select to_jsonb(r) into v from public.reviews r where r.id=new.review_id;
   t:=jsonb_build_array(to_jsonb(new));
   -- Null legacy hashes do not establish translation compatibility.
   if new.source_text_sha256 is null then return new;end if;
  end if;
  scope:=(v->>'establishment_id')::uuid;
 else
  kind:='shared';scope:=new.restaurant_id;
  if tg_table_name='shared_restaurant_reviews' then
   v:=coalesce(new.public_payload,'{}')||jsonb_build_object('external_review_id',new.external_id,'published_at',new.published_at,'rating',new.rating,'original_text',new.original_text,'text',new.original_text);t:='[]';
  else
   select coalesce(r.public_payload,'{}')||jsonb_build_object('external_review_id',r.external_id,'published_at',r.published_at,'rating',r.rating,'original_text',r.original_text,'text',r.original_text)
    into v from private.shared_restaurant_reviews r where r.restaurant_id=new.restaurant_id and r.external_id=new.external_id;
   t:=jsonb_build_array(to_jsonb(new));
  end if;
 end if;
 if v is not null then perform private.save_review_history(kind,scope,v,t);end if;
 return new;
end $$;
-- This AFTER trigger runs before recent_text_refresh, including a one-row ingestion.
create trigger history_capture after insert or update on public.reviews for each row execute function private.retain_review_history_row();
create trigger history_capture after insert or update on public.review_translations for each row execute function private.retain_review_history_row();
create trigger history_capture after insert or update on private.shared_restaurant_reviews for each row execute function private.retain_review_history_row();
create trigger history_capture after insert or update on private.shared_restaurant_review_translations for each row execute function private.retain_review_history_row();

-- Capture admitted and rejected-old bundle rows only AFTER all existing guards.
-- Failure of either operation rolls back the whole ingestion, not just history.
do $$declare d text;anchor text;begin
 d:=pg_get_functiondef('public.ingest_recent_reviews(uuid,uuid,jsonb,text)'::regprocedure);
 anchor:=' perform private.apply_recent_review_retention(p_establishment);';
 if strpos(d,anchor)=0 then raise exception 'HISTORY_INGEST_ANCHOR_MISSING';end if;
 execute replace(d,anchor,' perform private.retain_review_history_bundle(p_establishment,p_organization,p_bundle);'||chr(10)||anchor);
 -- The incremental commit normally filters already-known IDs. Capture the validated
 -- input before that filtering, without changing the novelty count or the watermark.
 d:=pg_get_functiondef('public.commit_incremental_review_sync_before_sharing(uuid,text,jsonb,jsonb)'::regprocedure);
 anchor:=' select coalesce(array_agg(id),''{}'') into old_ids from public.reviews where establishment_id=e.id;';
 if strpos(d,anchor)=0 then raise exception 'HISTORY_SYNC_ANCHOR_MISSING';end if;
 execute replace(d,anchor,' perform private.retain_incremental_review_history(e.id,e.organization_id,p_bundle,p_result);'||chr(10)||anchor);
end $$;

-- Seed just the current database. No archives, provider endpoints or review writes.
insert into private.review_history_scopes(scope_kind,scope_id) select 'local',id from public.establishments;
do $$declare r record;t jsonb;begin
 for r in select * from public.reviews order by establishment_id,external_review_id,updated_at loop
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into t from public.review_translations x where x.review_id=r.id and x.source_text_sha256 is not null;
  perform private.save_review_history('local',r.establishment_id,to_jsonb(r),t);
 end loop;
 for r in select * from private.shared_restaurant_reviews order by restaurant_id,external_id loop
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into t from private.shared_restaurant_review_translations x where x.restaurant_id=r.restaurant_id and x.external_id=r.external_id;
  perform private.save_review_history('shared',r.restaurant_id,coalesce(r.public_payload,'{}')||jsonb_build_object(
   'external_review_id',r.external_id,'published_at',r.published_at,'rating',r.rating,'original_text',r.original_text,'text',r.original_text),t);
 end loop;
end $$;

revoke all on function private.save_review_history(text,uuid,jsonb,jsonb),private.retain_review_history_bundle(uuid,uuid,jsonb),private.retain_incremental_review_history(uuid,uuid,jsonb,jsonb),private.retain_review_history_row() from public,anon,authenticated,service_role;
grant execute on function private.retain_review_history_bundle(uuid,uuid,jsonb),private.retain_incremental_review_history(uuid,uuid,jsonb,jsonb) to service_role;
commit;
