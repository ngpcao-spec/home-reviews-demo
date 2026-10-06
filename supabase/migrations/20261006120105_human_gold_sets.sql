-- Human-only experiment. No source mutation, schedule, provider or model call.
create table public.analysis_gold_sets (
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),establishment_id uuid not null references public.establishments(id),
  source_generation_id uuid not null,source_analysis_version integer not null check(source_analysis_version=7),jev_benchmark_id uuid not null,
  name text not null,methodology text not null check(methodology='diagnostic_disagreement_v1'),taxonomy_version text not null check(taxonomy_version='gold-taxonomy-v1'),taxonomy jsonb not null,
  target_reviews integer not null check(target_reviews=40),status text not null default 'draft' check(status in ('draft','completed')),
  source_fingerprint text not null,benchmark_fingerprint text not null,comparison jsonb,revision integer not null default 0,
  created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),completed_at timestamptz,
  unique(organization_id,source_generation_id,jev_benchmark_id,name),check((status='completed')=(completed_at is not null)),check(status='completed' or comparison is null),check(status<>'completed' or coalesce(jsonb_typeof(comparison)='object',false))
);
create table public.analysis_gold_set_reviews (
  gold_set_id uuid not null references public.analysis_gold_sets(id),review_id uuid not null,position integer not null check(position between 1 and 40),
  analysis_text_sha256 text not null check(analysis_text_sha256 ~ '^[a-f0-9]{64}$'),selection_bucket text not null check(selection_bucket in ('diagnostic','control')),
  excluded boolean not null default false,exclusion_reason text,confirmed_at timestamptz,confirmed_by uuid references auth.users(id),created_at timestamptz not null default now(),
  primary key(gold_set_id,review_id),check((excluded and exclusion_reason='translation_issue') or (not excluded and exclusion_reason is null))
);
create unique index gold_active_positions on public.analysis_gold_set_reviews(gold_set_id,position) where not excluded;
create table public.analysis_gold_labels (
  gold_set_id uuid not null,review_id uuid not null,theme_key text not null check(theme_key in ('food_quality','freshness','cooking','temperature','portions','presentation','drinks','variety','consistency','friendly_staff','attentiveness','wait_time','coordination','communication','order_accuracy','professionalism','atmosphere','decor','noise','comfort','cleanliness','location','value','billing','price_level')),
  choice text not null check(choice in ('absent','positive','negative','both','uncertain')),annotator_user_id uuid not null references auth.users(id),updated_at timestamptz not null default now(),
  primary key(gold_set_id,review_id,theme_key),foreign key(gold_set_id,review_id) references public.analysis_gold_set_reviews(gold_set_id,review_id)
);
create table public.analysis_gold_events (
  id bigint generated always as identity primary key,gold_set_id uuid not null references public.analysis_gold_sets(id),actor_user_id uuid not null references auth.users(id),
  action text not null check(action in ('created','confirmed_review','excluded_review','completed')),review_id uuid,payload jsonb not null default '{}',created_at timestamptz not null default now()
);
create index gold_org_created on public.analysis_gold_sets(organization_id,created_at desc);
create index gold_events_set on public.analysis_gold_events(gold_set_id,id);
alter table public.analysis_gold_sets enable row level security;
alter table public.analysis_gold_set_reviews enable row level security;
alter table public.analysis_gold_labels enable row level security;
alter table public.analysis_gold_events enable row level security;
-- API is the only read path: it hides selection buckets/predictions before completion.
revoke all on public.analysis_gold_sets,public.analysis_gold_set_reviews,public.analysis_gold_labels,public.analysis_gold_events from public,anon,authenticated;
grant all on public.analysis_gold_sets,public.analysis_gold_set_reviews,public.analysis_gold_labels,public.analysis_gold_events to service_role;
grant usage,select on sequence public.analysis_gold_events_id_seq to service_role;
create policy gold_org_read on public.analysis_gold_sets for select to authenticated using((select private.has_org_role(organization_id,array['owner','admin','manager'])));
create policy gold_reviews_org_read on public.analysis_gold_set_reviews for select to authenticated using(exists(select 1 from public.analysis_gold_sets g where g.id=gold_set_id and private.has_org_role(g.organization_id,array['owner','admin','manager'])));
create policy gold_labels_org_read on public.analysis_gold_labels for select to authenticated using(exists(select 1 from public.analysis_gold_sets g where g.id=gold_set_id and private.has_org_role(g.organization_id,array['owner','admin','manager'])));
create policy gold_events_org_read on public.analysis_gold_events for select to authenticated using(exists(select 1 from public.analysis_gold_sets g where g.id=gold_set_id and private.has_org_role(g.organization_id,array['owner','admin','manager'])));

create function public.gold_immutable_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare state text;
begin
  if tg_table_name='analysis_gold_sets' then
    if old.status='completed' then raise exception 'GOLD_IMMUTABLE'; end if;
    if tg_op='UPDATE' and (to_jsonb(old)-array['status','completed_at','comparison','revision']) is distinct from (to_jsonb(new)-array['status','completed_at','comparison','revision']) then raise exception 'GOLD_METADATA_IMMUTABLE'; end if;
  else
    if tg_table_name='analysis_gold_events' and tg_op<>'INSERT' then raise exception 'GOLD_AUDIT_IMMUTABLE'; end if;
    if tg_op in ('UPDATE','DELETE') then
      select status into state from public.analysis_gold_sets where id=old.gold_set_id for update;
      if state='completed' then raise exception 'GOLD_IMMUTABLE'; end if;
    end if;
    if tg_op='UPDATE' and (new.gold_set_id<>old.gold_set_id or new.review_id<>old.review_id) then raise exception 'GOLD_METADATA_IMMUTABLE'; end if;
    if tg_op='UPDATE' and tg_table_name='analysis_gold_set_reviews' and (to_jsonb(old)-array['excluded','exclusion_reason','confirmed_at','confirmed_by']) is distinct from (to_jsonb(new)-array['excluded','exclusion_reason','confirmed_at','confirmed_by']) then raise exception 'GOLD_METADATA_IMMUTABLE'; end if;
    select status into state from public.analysis_gold_sets where id=case when tg_op='DELETE' then old.gold_set_id else new.gold_set_id end for update;
    if state='completed' then raise exception 'GOLD_IMMUTABLE'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;return new;
end $$;
create trigger gold_sets_immutable before update or delete on public.analysis_gold_sets for each row execute function public.gold_immutable_guard();
create trigger gold_reviews_immutable before insert or update or delete on public.analysis_gold_set_reviews for each row execute function public.gold_immutable_guard();
create trigger gold_labels_immutable before insert or update or delete on public.analysis_gold_labels for each row execute function public.gold_immutable_guard();
create trigger gold_events_immutable before insert or update or delete on public.analysis_gold_events for each row execute function public.gold_immutable_guard();
revoke all on function public.gold_immutable_guard() from public,anon,authenticated;

create function public.create_human_gold_set(p_user uuid,p_source uuid,p_benchmark uuid,p_reviews jsonb,p_taxonomy jsonb,p_source_fingerprint text,p_benchmark_fingerprint text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare org uuid;est uuid;result uuid;item jsonb;actual_text text;
begin
  if p_source<>'b73ec894-d5fd-4b11-9fe6-cd89c117e9de'::uuid or p_benchmark<>'4c634678-17a9-47b3-89e1-fad0641f5d86'::uuid then raise exception 'GOLD_SOURCE_INVALID'; end if;
  select organization_id,establishment_id into org,est from public.historical_report_runs where generation_id=p_source and status='completed' and snapshot->>'analysis_version'='7';
  if org is null or not exists(select 1 from public.organization_members where organization_id=org and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from public.jev_benchmark_runs where id=p_benchmark and organization_id=org and establishment_id=est and source_generation_id=p_source and status='completed' and benchmark_type='themes_phase2' and source_analysis_version=7 and repeat_count=3) then raise exception 'GOLD_SOURCE_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('gold-create:'||p_source::text||':'||p_benchmark::text,0));
  select id into result from public.analysis_gold_sets where organization_id=org and source_generation_id=p_source and jev_benchmark_id=p_benchmark and name='shabu-v7-gold-v1';
  if found then return result; end if;
  if jsonb_array_length(p_reviews)<>40 or (select count(distinct x->>'review_id') from jsonb_array_elements(p_reviews) x)<>40 or (select count(*) from jsonb_object_keys(p_taxonomy))<>25 then raise exception 'GOLD_SELECTION_INVALID'; end if;
  insert into public.analysis_gold_sets(organization_id,establishment_id,source_generation_id,source_analysis_version,jev_benchmark_id,name,methodology,taxonomy_version,taxonomy,target_reviews,created_by,source_fingerprint,benchmark_fingerprint)
    values(org,est,p_source,7,p_benchmark,'shabu-v7-gold-v1','diagnostic_disagreement_v1','gold-taxonomy-v1',p_taxonomy,40,p_user,p_source_fingerprint,p_benchmark_fingerprint) returning id into result;
  for item in select * from jsonb_array_elements(p_reviews) loop
    select r->>'analysis_text' into actual_text from public.historical_report_runs h cross join lateral jsonb_array_elements(h.snapshot->'reviews') r where h.generation_id=p_source and r->>'id'=item->>'review_id' and r->>'analysis_language'='en';
    if actual_text is null or btrim(actual_text)='' or encode(extensions.digest(actual_text,'sha256'),'hex')<>item->>'analysis_text_sha256' then raise exception 'GOLD_TEXT_INTEGRITY_FAILED'; end if;
    insert into public.analysis_gold_set_reviews(gold_set_id,review_id,position,analysis_text_sha256,selection_bucket) values(result,(item->>'review_id')::uuid,(item->>'position')::integer,item->>'analysis_text_sha256',item->>'selection_bucket');
  end loop;
  insert into public.analysis_gold_events(gold_set_id,actor_user_id,action) values(result,p_user,'created');return result;
end $$;

create function public.write_human_gold_set(p_user uuid,p_id uuid,p_revision integer,p_action text,p_payload jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare g public.analysis_gold_sets;rv public.analysis_gold_set_reviews;item record;actual_text text;previous_labels jsonb;
begin
  select * into g from public.analysis_gold_sets where id=p_id for update;
  if g.id is null or not exists(select 1 from public.organization_members where organization_id=g.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN'; end if;
  if g.status<>'draft' then raise exception 'GOLD_IMMUTABLE'; end if;
  if g.revision is distinct from p_revision then raise exception 'GOLD_REVISION_CHANGED'; end if;
  if p_action in ('confirm_review','exclude_review') then
    select * into rv from public.analysis_gold_set_reviews where gold_set_id=p_id and review_id=(p_payload->>'review_id')::uuid and not excluded;
    if rv.review_id is null then raise exception 'GOLD_REVIEW_NOT_ACTIVE'; end if;
    if p_action='confirm_review' then
      if (select count(*) from jsonb_object_keys(p_payload->'choices'))<>25 then raise exception 'GOLD_CHOICES_INVALID'; end if;
      select jsonb_object_agg(theme_key,choice) into previous_labels from public.analysis_gold_labels where gold_set_id=p_id and review_id=rv.review_id;
      for item in select * from jsonb_each_text(p_payload->'choices') loop
        insert into public.analysis_gold_labels(gold_set_id,review_id,theme_key,choice,annotator_user_id) values(p_id,rv.review_id,item.key,item.value,p_user)
          on conflict(gold_set_id,review_id,theme_key) do update set choice=excluded.choice,annotator_user_id=p_user,updated_at=now();
      end loop;
      update public.analysis_gold_set_reviews set confirmed_at=now(),confirmed_by=p_user where gold_set_id=p_id and review_id=rv.review_id;
      insert into public.analysis_gold_events(gold_set_id,actor_user_id,action,review_id,payload) values(p_id,p_user,'confirmed_review',rv.review_id,jsonb_build_object('previous',previous_labels,'choices',p_payload->'choices'));
    else
      select r->>'analysis_text' into actual_text from public.historical_report_runs h cross join lateral jsonb_array_elements(h.snapshot->'reviews') r where h.generation_id=g.source_generation_id and r->>'id'=p_payload->'replacement'->>'review_id' and r->>'analysis_language'='en';
      if actual_text is null or btrim(actual_text)='' or encode(extensions.digest(actual_text,'sha256'),'hex')<>p_payload->'replacement'->>'analysis_text_sha256' then raise exception 'GOLD_TEXT_INTEGRITY_FAILED'; end if;
      update public.analysis_gold_set_reviews set excluded=true,exclusion_reason='translation_issue' where gold_set_id=p_id and review_id=rv.review_id;
      insert into public.analysis_gold_set_reviews(gold_set_id,review_id,position,analysis_text_sha256,selection_bucket) values(p_id,(p_payload->'replacement'->>'review_id')::uuid,rv.position,p_payload->'replacement'->>'analysis_text_sha256',p_payload->'replacement'->>'selection_bucket');
      insert into public.analysis_gold_events(gold_set_id,actor_user_id,action,review_id,payload) values(p_id,p_user,'excluded_review',rv.review_id,jsonb_build_object('reason','translation_issue','replacement_review_id',p_payload->'replacement'->>'review_id'));
    end if;
  elsif p_action='finalize' then
    if (select count(*) from public.analysis_gold_set_reviews where gold_set_id=p_id and not excluded)<>40 or exists(select 1 from public.analysis_gold_set_reviews r where r.gold_set_id=p_id and not r.excluded and (r.confirmed_at is null or (select count(*) from public.analysis_gold_labels l where l.gold_set_id=p_id and l.review_id=r.review_id)<>25)) then raise exception 'GOLD_INCOMPLETE'; end if;
    if p_payload->'comparison' is null then raise exception 'GOLD_COMPARISON_REQUIRED'; end if;
    -- Audit first; after this update all review/label writes are immutable.
    insert into public.analysis_gold_events(gold_set_id,actor_user_id,action) values(p_id,p_user,'completed');
    update public.analysis_gold_sets set status='completed',completed_at=now(),comparison=p_payload->'comparison',revision=revision+1 where id=p_id;return g.revision+1;
  else raise exception 'GOLD_ACTION_INVALID'; end if;
  update public.analysis_gold_sets set revision=revision+1 where id=p_id;return g.revision+1;
end $$;
revoke all on function public.create_human_gold_set(uuid,uuid,uuid,jsonb,jsonb,text,text),public.write_human_gold_set(uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_human_gold_set(uuid,uuid,uuid,jsonb,jsonb,text,text),public.write_human_gold_set(uuid,uuid,integer,text,jsonb) to service_role;
