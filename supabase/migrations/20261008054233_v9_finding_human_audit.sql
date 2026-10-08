-- Manual finding-level human audit. No source mutations, scheduling or provider calls.
create table public.analysis_v9_finding_audits (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), establishment_id uuid not null references public.establishments(id),
  source_v8_generation_id uuid not null, source_v9_generation_id uuid not null,
  name text not null default 'shabu-v9-only-finding-audit-v1' check(name='shabu-v9-only-finding-audit-v1'),
  methodology text not null default 'v9_only_finding_audit_v1' check(methodology='v9_only_finding_audit_v1'),
  taxonomy_version text not null default 'gold-taxonomy-v1' check(taxonomy_version='gold-taxonomy-v1'), taxonomy jsonb not null check(jsonb_typeof(taxonomy)='object'),
  target_findings integer not null default 30 check(target_findings=30), status text not null default 'draft' check(status in ('draft','completed')),
  revision integer not null default 0 check(revision>=0), source_fingerprint text not null check(source_fingerprint~'^[a-f0-9]{64}$'), selection_metadata jsonb not null, comparison jsonb,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), completed_at timestamptz,
  unique(organization_id,source_v8_generation_id,source_v9_generation_id,name),
  check((status='completed')=(completed_at is not null)),check(status='completed' or comparison is null),check(status<>'completed' or coalesce(jsonb_typeof(comparison)='object',false))
);
create table public.analysis_v9_finding_audit_items (
  id uuid not null default gen_random_uuid(), audit_id uuid not null references public.analysis_v9_finding_audits(id), review_id uuid not null, theme_key text not null,
  sentiment text not null check(sentiment in ('positive','negative')), position integer not null check(position between 1 and 30),
  analysis_text_sha256 text not null check(analysis_text_sha256~'^[a-f0-9]{64}$'), selection_hash text not null check(selection_hash~'^[a-f0-9]{64}$'),
  probability_positive double precision not null check(probability_positive between 0 and 1), probability_negative double precision not null check(probability_negative between 0 and 1), repeat_stable boolean not null,
  created_at timestamptz not null default now(), primary key(audit_id,id),unique(audit_id,review_id,theme_key,sentiment),unique(audit_id,position)
);
create table public.analysis_v9_finding_audit_labels (
  audit_id uuid not null,item_id uuid not null,choice text not null check(choice in ('positive','negative','both','absent','uncertain')),
  annotator_user_id uuid not null references auth.users(id),updated_at timestamptz not null default now(),primary key(audit_id,item_id),
  foreign key(audit_id,item_id) references public.analysis_v9_finding_audit_items(audit_id,id)
);
create table public.analysis_v9_finding_audit_events (
  id bigint generated always as identity primary key,audit_id uuid not null references public.analysis_v9_finding_audits(id),item_id uuid,
  actor_user_id uuid not null references auth.users(id),action text not null check(action in ('created','saved_choice','completed')),payload jsonb not null default '{}',created_at timestamptz not null default now()
);
create index finding_audit_org_created on public.analysis_v9_finding_audits(organization_id,created_at desc);
create index finding_audit_events_parent on public.analysis_v9_finding_audit_events(audit_id,id);
alter table public.analysis_v9_finding_audits enable row level security;
alter table public.analysis_v9_finding_audit_items enable row level security;
alter table public.analysis_v9_finding_audit_labels enable row level security;
alter table public.analysis_v9_finding_audit_events enable row level security;
-- Raw prediction-bearing rows are private even to authorized annotators. Edge API projects a blind view.
revoke all on public.analysis_v9_finding_audits,public.analysis_v9_finding_audit_items,public.analysis_v9_finding_audit_labels,public.analysis_v9_finding_audit_events from public,anon,authenticated;
grant all on public.analysis_v9_finding_audits,public.analysis_v9_finding_audit_items,public.analysis_v9_finding_audit_labels,public.analysis_v9_finding_audit_events to service_role;
grant usage,select on sequence public.analysis_v9_finding_audit_events_id_seq to service_role;
create policy finding_audit_org_read on public.analysis_v9_finding_audits for select to authenticated using((select private.has_org_role(organization_id,array['owner','admin','manager'])));
create policy finding_audit_items_org_read on public.analysis_v9_finding_audit_items for select to authenticated using(exists(select 1 from public.analysis_v9_finding_audits a where a.id=audit_id and private.has_org_role(a.organization_id,array['owner','admin','manager'])));
create policy finding_audit_labels_org_read on public.analysis_v9_finding_audit_labels for select to authenticated using(exists(select 1 from public.analysis_v9_finding_audits a where a.id=audit_id and private.has_org_role(a.organization_id,array['owner','admin','manager'])));
create policy finding_audit_events_org_read on public.analysis_v9_finding_audit_events for select to authenticated using(exists(select 1 from public.analysis_v9_finding_audits a where a.id=audit_id and private.has_org_role(a.organization_id,array['owner','admin','manager'])));

create function public.v9_finding_audit_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare state text;parent uuid;
begin
  if tg_table_name='analysis_v9_finding_audits' then
    if old.status='completed' then raise exception 'FINDING_AUDIT_IMMUTABLE';end if;
    if tg_op='DELETE' then raise exception 'FINDING_AUDIT_AUDIT_IMMUTABLE';end if;
    if (to_jsonb(old)-array['status','completed_at','comparison','revision']) is distinct from (to_jsonb(new)-array['status','completed_at','comparison','revision']) then raise exception 'FINDING_AUDIT_METADATA_IMMUTABLE';end if;
    if new.status='completed' and ((select count(*) from public.analysis_v9_finding_audit_items where audit_id=old.id)<>30 or (select count(*) from public.analysis_v9_finding_audit_labels where audit_id=old.id)<>30) then raise exception 'FINDING_AUDIT_INCOMPLETE';end if;
  else
    parent=case when tg_op='DELETE' then old.audit_id else new.audit_id end;
    select status into state from public.analysis_v9_finding_audits where id=parent for update;
    if state='completed' then raise exception 'FINDING_AUDIT_IMMUTABLE';end if;
    if tg_table_name in ('analysis_v9_finding_audit_events','analysis_v9_finding_audit_items') and tg_op<>'INSERT' then raise exception 'FINDING_AUDIT_AUDIT_IMMUTABLE';end if;
    if tg_table_name='analysis_v9_finding_audit_labels' then
      if tg_op='DELETE' then raise exception 'FINDING_AUDIT_AUDIT_IMMUTABLE';end if;
      if tg_op='UPDATE' and (new.audit_id<>old.audit_id or new.item_id<>old.item_id) then raise exception 'FINDING_AUDIT_METADATA_IMMUTABLE';end if;
    end if;
  end if;
  return new;
end $$;
create trigger finding_audit_immutable before update or delete on public.analysis_v9_finding_audits for each row execute function public.v9_finding_audit_guard();
create trigger finding_audit_items_immutable before insert or update or delete on public.analysis_v9_finding_audit_items for each row execute function public.v9_finding_audit_guard();
create trigger finding_audit_labels_immutable before insert or update or delete on public.analysis_v9_finding_audit_labels for each row execute function public.v9_finding_audit_guard();
create trigger finding_audit_events_immutable before insert or update or delete on public.analysis_v9_finding_audit_events for each row execute function public.v9_finding_audit_guard();
revoke all on function public.v9_finding_audit_guard() from public,anon,authenticated;

create function public.create_v9_finding_audit(p_user uuid,p_items jsonb,p_selection jsonb,p_fingerprint text,p_taxonomy jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare a public.historical_report_runs;b public.historical_report_runs;result uuid;item jsonb;source_finding jsonb;actual_text text;
begin
  select * into a from public.historical_report_runs where generation_id='307025ef-05b1-401e-8f6d-e48ca5677553' and status='completed' and snapshot->>'analysis_version'='8';
  select * into b from public.historical_report_runs where generation_id='91b77ec8-b58c-4735-a96d-496fa1a5404a' and status='completed' and snapshot->>'analysis_version'='9';
  if a.id is null or b.id is null or a.organization_id<>b.organization_id or a.establishment_id<>b.establishment_id then raise exception 'FINDING_AUDIT_SOURCE_REQUIRED';end if;
  if not exists(select 1 from public.organization_members where organization_id=b.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
  perform pg_advisory_xact_lock(hashtextextended('finding-audit:'||b.generation_id::text,0));
  select id into result from public.analysis_v9_finding_audits where organization_id=b.organization_id and source_v8_generation_id=a.generation_id and source_v9_generation_id=b.generation_id and name='shabu-v9-only-finding-audit-v1';if found then return result;end if;
  if jsonb_array_length(p_items)<>30 or (select count(distinct (x->>'review_id',x->>'theme_key',x->>'sentiment')) from jsonb_array_elements(p_items) x)<>30 then raise exception 'FINDING_AUDIT_SELECTION_INVALID';end if;
  if coalesce(jsonb_typeof(p_taxonomy),'null')<>'object' or (select count(*) from jsonb_object_keys(p_taxonomy))<>25 or not exists(select 1 from public.analysis_gold_sets where taxonomy_version='gold-taxonomy-v1' and organization_id=b.organization_id and taxonomy=p_taxonomy) then raise exception 'FINDING_AUDIT_TAXONOMY_CHANGED';end if;
  if jsonb_array_length(a.snapshot->'reviews')<>jsonb_array_length(b.snapshot->'reviews') or exists(select 1 from jsonb_array_elements(b.snapshot->'reviews') r where not exists(select 1 from jsonb_array_elements(a.snapshot->'reviews') s where s->>'id'=r->>'id' and s->>'analysis_text'=r->>'analysis_text')) then raise exception 'FINDING_AUDIT_DATASET_CHANGED';end if;
  insert into public.analysis_v9_finding_audits(organization_id,establishment_id,source_v8_generation_id,source_v9_generation_id,taxonomy,source_fingerprint,selection_metadata,created_by)
    values(b.organization_id,b.establishment_id,a.generation_id,b.generation_id,p_taxonomy,p_fingerprint,p_selection,p_user) returning id into result;
  for item in select * from jsonb_array_elements(p_items) loop
    if not (p_taxonomy ? (item->>'theme_key')) then raise exception 'FINDING_AUDIT_THEME_INVALID';end if;
    select f into source_finding from jsonb_array_elements(b.findings) f where f->>'review_id'=item->>'review_id' and f->>'theme_key'=item->>'theme_key' and f->>'sentiment'=item->>'sentiment';
    if source_finding is null or exists(select 1 from jsonb_array_elements(a.findings) f where f->>'review_id'=item->>'review_id' and f->>'theme_key'=item->>'theme_key' and f->>'sentiment'=item->>'sentiment') then raise exception 'FINDING_AUDIT_NOT_V9_ONLY';end if;
    select r->>'analysis_text' into actual_text from jsonb_array_elements(b.snapshot->'reviews') r where r->>'id'=item->>'review_id' and r->>'analysis_language'='en';
    if actual_text is null or btrim(actual_text)='' or encode(extensions.digest(actual_text,'sha256'),'hex') is distinct from item->>'analysis_text_sha256' then raise exception 'FINDING_AUDIT_TEXT_CHANGED';end if;
    if encode(extensions.digest(b.generation_id::text||(item->>'theme_key')||(item->>'review_id')||(item->>'sentiment'),'sha256'),'hex') is distinct from item->>'selection_hash' then raise exception 'FINDING_AUDIT_SELECTION_INVALID';end if;
    if source_finding->'probability_positive' is distinct from item->'probability_positive' or source_finding->'probability_negative' is distinct from item->'probability_negative' or source_finding->'repeat_stable' is distinct from item->'repeat_stable' then raise exception 'FINDING_AUDIT_PROBABILITIES_CHANGED';end if;
    insert into public.analysis_v9_finding_audit_items(audit_id,review_id,theme_key,sentiment,position,analysis_text_sha256,selection_hash,probability_positive,probability_negative,repeat_stable)
      values(result,(item->>'review_id')::uuid,item->>'theme_key',item->>'sentiment',(item->>'position')::integer,item->>'analysis_text_sha256',item->>'selection_hash',(item->>'probability_positive')::double precision,(item->>'probability_negative')::double precision,(item->>'repeat_stable')::boolean);
  end loop;
  insert into public.analysis_v9_finding_audit_events(audit_id,actor_user_id,action) values(result,p_user,'created');return result;
end $$;

create function public.write_v9_finding_audit(p_user uuid,p_id uuid,p_revision integer,p_action text,p_payload jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare a public.analysis_v9_finding_audits;i public.analysis_v9_finding_audit_items;previous_choice text;
begin
  select * into a from public.analysis_v9_finding_audits where id=p_id for update;
  if a.id is null or not exists(select 1 from public.organization_members where organization_id=a.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
  if a.status<>'draft' then raise exception 'FINDING_AUDIT_IMMUTABLE';end if;
  if a.revision is distinct from p_revision then raise exception 'FINDING_AUDIT_REVISION_CHANGED';end if;
  if p_action='save_choice' then
    select * into i from public.analysis_v9_finding_audit_items where audit_id=p_id and id=(p_payload->>'item_id')::uuid;
    if i.id is null then raise exception 'FINDING_AUDIT_ITEM_INVALID';end if;
    select choice into previous_choice from public.analysis_v9_finding_audit_labels where audit_id=p_id and item_id=i.id;
    insert into public.analysis_v9_finding_audit_labels(audit_id,item_id,choice,annotator_user_id) values(p_id,i.id,p_payload->>'choice',p_user)
      on conflict(audit_id,item_id) do update set choice=excluded.choice,annotator_user_id=p_user,updated_at=now();
    insert into public.analysis_v9_finding_audit_events(audit_id,item_id,actor_user_id,action,payload) values(p_id,i.id,p_user,'saved_choice',jsonb_build_object('previous_choice',previous_choice,'choice',p_payload->>'choice'));
  elsif p_action='finalize' then
    if (select count(*) from public.analysis_v9_finding_audit_items where audit_id=p_id)<>30 or (select count(*) from public.analysis_v9_finding_audit_labels where audit_id=p_id)<>30 then raise exception 'FINDING_AUDIT_INCOMPLETE';end if;
    if coalesce(jsonb_typeof(p_payload->'comparison'),'null')<>'object' then raise exception 'FINDING_AUDIT_COMPARISON_REQUIRED';end if;
    insert into public.analysis_v9_finding_audit_events(audit_id,actor_user_id,action) values(p_id,p_user,'completed');
    update public.analysis_v9_finding_audits set status='completed',completed_at=now(),comparison=p_payload->'comparison',revision=revision+1 where id=p_id;return a.revision+1;
  else raise exception 'FINDING_AUDIT_ACTION_INVALID';end if;
  update public.analysis_v9_finding_audits set revision=revision+1 where id=p_id;return a.revision+1;
end $$;
revoke all on function public.create_v9_finding_audit(uuid,jsonb,jsonb,text,jsonb),public.write_v9_finding_audit(uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_v9_finding_audit(uuid,jsonb,jsonb,text,jsonb),public.write_v9_finding_audit(uuid,uuid,integer,text,jsonb) to service_role;
