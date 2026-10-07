-- Separate, human-only final check. No source updates or scheduling.
create table public.analysis_gold_adjudications (
  id uuid primary key default gen_random_uuid(),gold_set_id uuid not null references public.analysis_gold_sets(id),organization_id uuid not null references public.organizations(id),
  source_generation_id uuid not null,jev_benchmark_id uuid not null,taxonomy_version text not null check(taxonomy_version='gold-taxonomy-v1'),taxonomy jsonb not null,
  name text not null check(name='shabu-v7-human-check-v1'),methodology text not null check(methodology='human_final_adjudication_v1'),target_reviews integer not null check(target_reviews=12),
  status text not null default 'draft' check(status in ('draft','completed')),revision integer not null default 0,source_fingerprint text not null,selection_metadata jsonb not null,comparison jsonb,
  created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),completed_at timestamptz,
  unique(organization_id,gold_set_id,name),check((status='completed')=(completed_at is not null)),check(status='completed' or comparison is null),check(status<>'completed' or coalesce(jsonb_typeof(comparison)='object',false))
);
create table public.analysis_gold_adjudication_items (
  adjudication_id uuid not null references public.analysis_gold_adjudications(id),review_id uuid not null,position integer not null check(position between 1 and 12),
  analysis_text_sha256 text not null check(analysis_text_sha256~'^[a-f0-9]{64}$'),themes jsonb not null check(jsonb_typeof(themes)='array' and jsonb_array_length(themes) between 1 and 3),
  confirmed_at timestamptz,confirmed_by uuid references auth.users(id),created_at timestamptz not null default now(),primary key(adjudication_id,review_id),unique(adjudication_id,position)
);
create table public.analysis_gold_adjudication_labels (
  adjudication_id uuid not null,review_id uuid not null,theme_key text not null,
  choice text not null check(choice in ('absent','positive','negative','both','uncertain')),annotator_user_id uuid not null references auth.users(id),updated_at timestamptz not null default now(),
  primary key(adjudication_id,review_id,theme_key),foreign key(adjudication_id,review_id) references public.analysis_gold_adjudication_items(adjudication_id,review_id)
);
create table public.analysis_gold_adjudication_events (
  id bigint generated always as identity primary key,adjudication_id uuid not null references public.analysis_gold_adjudications(id),actor_user_id uuid not null references auth.users(id),
  action text not null check(action in ('created','saved_choice','completed')),review_id uuid,payload jsonb not null default '{}',created_at timestamptz not null default now()
);
create index adjudication_org_created on public.analysis_gold_adjudications(organization_id,created_at desc);
create index adjudication_events_parent on public.analysis_gold_adjudication_events(adjudication_id,id);
alter table public.analysis_gold_adjudications enable row level security;
alter table public.analysis_gold_adjudication_items enable row level security;
alter table public.analysis_gold_adjudication_labels enable row level security;
alter table public.analysis_gold_adjudication_events enable row level security;
revoke all on public.analysis_gold_adjudications,public.analysis_gold_adjudication_items,public.analysis_gold_adjudication_labels,public.analysis_gold_adjudication_events from public,anon,authenticated;
grant all on public.analysis_gold_adjudications,public.analysis_gold_adjudication_items,public.analysis_gold_adjudication_labels,public.analysis_gold_adjudication_events to service_role;
grant usage,select on sequence public.analysis_gold_adjudication_events_id_seq to service_role;
create policy adjudication_org_read on public.analysis_gold_adjudications for select to authenticated using((select private.has_org_role(organization_id,array['owner','admin','manager'])));
create policy adjudication_items_org_read on public.analysis_gold_adjudication_items for select to authenticated using(exists(select 1 from public.analysis_gold_adjudications a where a.id=adjudication_id and private.has_org_role(a.organization_id,array['owner','admin','manager'])));
create policy adjudication_labels_org_read on public.analysis_gold_adjudication_labels for select to authenticated using(exists(select 1 from public.analysis_gold_adjudications a where a.id=adjudication_id and private.has_org_role(a.organization_id,array['owner','admin','manager'])));
create policy adjudication_events_org_read on public.analysis_gold_adjudication_events for select to authenticated using(exists(select 1 from public.analysis_gold_adjudications a where a.id=adjudication_id and private.has_org_role(a.organization_id,array['owner','admin','manager'])));

create function public.gold_adjudication_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare state text;
begin
  if tg_table_name='analysis_gold_adjudications' then
    if old.status='completed' then raise exception 'ADJUDICATION_IMMUTABLE'; end if;
    if tg_op='UPDATE' and (to_jsonb(old)-array['status','completed_at','comparison','revision']) is distinct from (to_jsonb(new)-array['status','completed_at','comparison','revision']) then raise exception 'ADJUDICATION_METADATA_IMMUTABLE'; end if;
  else
    if tg_table_name='analysis_gold_adjudication_events' and tg_op<>'INSERT' then raise exception 'ADJUDICATION_AUDIT_IMMUTABLE'; end if;
    if tg_op in ('UPDATE','DELETE') then
      select status into state from public.analysis_gold_adjudications where id=old.adjudication_id for update;
      if state='completed' then raise exception 'ADJUDICATION_IMMUTABLE'; end if;
    end if;
    if tg_op='UPDATE' and (new.adjudication_id<>old.adjudication_id or new.review_id<>old.review_id) then raise exception 'ADJUDICATION_METADATA_IMMUTABLE'; end if;
    if tg_op='UPDATE' and tg_table_name='analysis_gold_adjudication_items' and (to_jsonb(old)-array['confirmed_at','confirmed_by']) is distinct from (to_jsonb(new)-array['confirmed_at','confirmed_by']) then raise exception 'ADJUDICATION_METADATA_IMMUTABLE'; end if;
    select status into state from public.analysis_gold_adjudications where id=case when tg_op='DELETE' then old.adjudication_id else new.adjudication_id end for update;
    if state='completed' then raise exception 'ADJUDICATION_IMMUTABLE'; end if;
    if tg_table_name='analysis_gold_adjudication_labels' and tg_op<>'DELETE' then
      if not exists(select 1 from public.analysis_gold_adjudication_items i where i.adjudication_id=new.adjudication_id and i.review_id=new.review_id and i.themes ? new.theme_key) then raise exception 'ADJUDICATION_THEME_INVALID'; end if;
      if tg_op='UPDATE' and new.theme_key<>old.theme_key then raise exception 'ADJUDICATION_METADATA_IMMUTABLE'; end if;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;return new;
end $$;
create trigger adjudication_immutable before update or delete on public.analysis_gold_adjudications for each row execute function public.gold_adjudication_guard();
create trigger adjudication_items_immutable before insert or update or delete on public.analysis_gold_adjudication_items for each row execute function public.gold_adjudication_guard();
create trigger adjudication_labels_immutable before insert or update or delete on public.analysis_gold_adjudication_labels for each row execute function public.gold_adjudication_guard();
create trigger adjudication_events_immutable before insert or update or delete on public.analysis_gold_adjudication_events for each row execute function public.gold_adjudication_guard();
revoke all on function public.gold_adjudication_guard() from public,anon,authenticated;

create function public.create_gold_adjudication(p_user uuid,p_gold uuid,p_items jsonb,p_selection jsonb,p_fingerprint text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare g public.analysis_gold_sets;result uuid;item jsonb;theme text;actual_text text;
begin
  if p_gold is distinct from '1d5cfc8c-ac77-4e44-a7a7-6153eb132385'::uuid then raise exception 'ADJUDICATION_GOLD_REQUIRED'; end if;
  select * into g from public.analysis_gold_sets where id=p_gold and status='completed' and taxonomy_version='gold-taxonomy-v1';
  if g.id is null or not exists(select 1 from public.organization_members where organization_id=g.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('adjudication:'||p_gold::text,0));
  select id into result from public.analysis_gold_adjudications where gold_set_id=p_gold and organization_id=g.organization_id and name='shabu-v7-human-check-v1';if found then return result;end if;
  if jsonb_array_length(p_items)<>12 or (select count(distinct x->>'review_id') from jsonb_array_elements(p_items) x)<>12 then raise exception 'ADJUDICATION_SELECTION_INVALID'; end if;
  insert into public.analysis_gold_adjudications(gold_set_id,organization_id,source_generation_id,jev_benchmark_id,taxonomy_version,taxonomy,name,methodology,target_reviews,created_by,source_fingerprint,selection_metadata)
    values(g.id,g.organization_id,g.source_generation_id,g.jev_benchmark_id,g.taxonomy_version,g.taxonomy,'shabu-v7-human-check-v1','human_final_adjudication_v1',12,p_user,p_fingerprint,p_selection) returning id into result;
  for item in select * from jsonb_array_elements(p_items) loop
    if not exists(select 1 from public.analysis_gold_set_reviews where gold_set_id=g.id and review_id=(item->>'review_id')::uuid and not excluded) then raise exception 'ADJUDICATION_REVIEW_INVALID'; end if;
    if jsonb_array_length(item->'themes') not between 1 and 3 or (select count(distinct x) from jsonb_array_elements_text(item->'themes') x)<>jsonb_array_length(item->'themes') then raise exception 'ADJUDICATION_THEME_INVALID'; end if;
    for theme in select * from jsonb_array_elements_text(item->'themes') loop
      if not (g.taxonomy ? theme) or not exists(select 1 from public.analysis_gold_labels where gold_set_id=g.id and review_id=(item->>'review_id')::uuid and theme_key=theme) then raise exception 'ADJUDICATION_THEME_INVALID'; end if;
    end loop;
    select r->>'analysis_text' into actual_text from public.historical_report_runs h cross join lateral jsonb_array_elements(h.snapshot->'reviews') r where h.generation_id=g.source_generation_id and r->>'id'=item->>'review_id' and r->>'analysis_language'='en';
    if actual_text is null or btrim(actual_text)='' or encode(extensions.digest(actual_text,'sha256'),'hex')<>item->>'analysis_text_sha256' then raise exception 'ADJUDICATION_TEXT_CHANGED'; end if;
    insert into public.analysis_gold_adjudication_items(adjudication_id,review_id,position,analysis_text_sha256,themes) values(result,(item->>'review_id')::uuid,(item->>'position')::integer,item->>'analysis_text_sha256',item->'themes');
  end loop;
  insert into public.analysis_gold_adjudication_events(adjudication_id,actor_user_id,action) values(result,p_user,'created');return result;
end $$;

create function public.write_gold_adjudication(p_user uuid,p_id uuid,p_revision integer,p_action text,p_payload jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare a public.analysis_gold_adjudications;i public.analysis_gold_adjudication_items;previous_choice text;
begin
  select * into a from public.analysis_gold_adjudications where id=p_id for update;
  if a.id is null or not exists(select 1 from public.organization_members where organization_id=a.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN'; end if;
  if a.status<>'draft' then raise exception 'ADJUDICATION_IMMUTABLE'; end if;
  if a.revision is distinct from p_revision then raise exception 'ADJUDICATION_REVISION_CHANGED'; end if;
  if p_action='save_choice' then
    select * into i from public.analysis_gold_adjudication_items where adjudication_id=p_id and review_id=(p_payload->>'review_id')::uuid;
    if i.review_id is null or not (i.themes ? (p_payload->>'theme_key')) then raise exception 'ADJUDICATION_THEME_INVALID'; end if;
    select choice into previous_choice from public.analysis_gold_adjudication_labels where adjudication_id=p_id and review_id=i.review_id and theme_key=p_payload->>'theme_key';
    insert into public.analysis_gold_adjudication_labels(adjudication_id,review_id,theme_key,choice,annotator_user_id) values(p_id,i.review_id,p_payload->>'theme_key',p_payload->>'choice',p_user)
      on conflict(adjudication_id,review_id,theme_key) do update set choice=excluded.choice,annotator_user_id=p_user,updated_at=now();
    update public.analysis_gold_adjudication_items set confirmed_at=case when (select count(*) from public.analysis_gold_adjudication_labels l where l.adjudication_id=p_id and l.review_id=i.review_id)=jsonb_array_length(i.themes) then now() else null end,confirmed_by=p_user where adjudication_id=p_id and review_id=i.review_id;
    insert into public.analysis_gold_adjudication_events(adjudication_id,actor_user_id,action,review_id,payload) values(p_id,p_user,'saved_choice',i.review_id,jsonb_build_object('theme_key',p_payload->>'theme_key','previous_choice',previous_choice,'choice',p_payload->>'choice'));
  elsif p_action='finalize' then
    if (select count(*) from public.analysis_gold_adjudication_items where adjudication_id=p_id)<>12 or exists(select 1 from public.analysis_gold_adjudication_items it where it.adjudication_id=p_id and (it.confirmed_at is null or (select count(*) from public.analysis_gold_adjudication_labels l where l.adjudication_id=p_id and l.review_id=it.review_id)<>jsonb_array_length(it.themes))) then raise exception 'ADJUDICATION_INCOMPLETE'; end if;
    if coalesce(jsonb_typeof(p_payload->'comparison'),'null')<>'object' then raise exception 'ADJUDICATION_COMPARISON_REQUIRED'; end if;
    insert into public.analysis_gold_adjudication_events(adjudication_id,actor_user_id,action) values(p_id,p_user,'completed');
    update public.analysis_gold_adjudications set status='completed',completed_at=now(),comparison=p_payload->'comparison',revision=revision+1 where id=p_id;return a.revision+1;
  else raise exception 'ADJUDICATION_ACTION_INVALID'; end if;
  update public.analysis_gold_adjudications set revision=revision+1 where id=p_id;return a.revision+1;
end $$;
revoke all on function public.create_gold_adjudication(uuid,uuid,jsonb,jsonb,text),public.write_gold_adjudication(uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_gold_adjudication(uuid,uuid,jsonb,jsonb,text),public.write_gold_adjudication(uuid,uuid,integer,text,jsonb) to service_role;
