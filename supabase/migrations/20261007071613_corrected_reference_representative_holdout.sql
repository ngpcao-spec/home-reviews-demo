-- New assisted reference and independent holdout only. Original resources SELECT only.
create table public.analysis_corrected_references (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),establishment_id uuid not null,
 source_gold_set_id uuid not null references public.analysis_gold_sets(id),source_adjudication_id uuid not null references public.analysis_gold_adjudications(id),source_generation_id uuid not null,jev_benchmark_id uuid not null,
 name text not null check(name='shabu-v7-gold-v2-assisted'),methodology text not null check(methodology='human_corrected_reference_v2'),taxonomy_version text not null check(taxonomy_version='gold-taxonomy-v1'),taxonomy jsonb not null,
 assisted boolean not null default true check(assisted),status text not null check(status in ('building','completed')),label_count integer not null default 0,human_label_count integer not null default 0,human_comparable_count integer not null default 0,human_uncertain_count integer not null default 0,
 source_fingerprint text not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),completed_at timestamptz,
 unique(organization_id,source_gold_set_id,source_adjudication_id,name),check((status='completed')=(completed_at is not null))
);
create table public.analysis_corrected_reference_labels (
 reference_id uuid not null references public.analysis_corrected_references(id),review_id uuid not null,theme_key text not null,choice text not null check(choice in ('absent','positive','negative','both','uncertain')),
 source text not null check(source in ('gold_v1','human_adjudication')),source_gold_set_id uuid not null,source_adjudication_id uuid,annotator_user_id uuid not null references auth.users(id),source_updated_at timestamptz not null,
 primary key(reference_id,review_id,theme_key),check((source='human_adjudication')=(source_adjudication_id is not null))
);
create table public.analysis_representative_human_tests (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),establishment_id uuid not null,source_generation_id uuid not null,
 gold_v1_id uuid not null references public.analysis_gold_sets(id),gold_v2_reference_id uuid not null references public.analysis_corrected_references(id),previous_adjudication_id uuid not null references public.analysis_gold_adjudications(id),jev_benchmark_id uuid not null,
 name text not null default 'shabu-v7-representative-holdout-v1',methodology text not null check(methodology='representative_holdout_v1'),selection_method text not null check(selection_method='sha256_source_review_v1'),selection_seed text not null,candidate_count integer not null,pool_stats jsonb not null,selected_review_ids jsonb not null,
 taxonomy_version text not null check(taxonomy_version='gold-taxonomy-v1'),taxonomy jsonb not null,target_reviews integer not null check(target_reviews=12),status text not null default 'draft' check(status in ('draft','completed')),revision integer not null default 0,source_fingerprint text not null,comparison jsonb,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),completed_at timestamptz,
 unique(organization_id,source_generation_id,name),check((status='completed')=(completed_at is not null)),check(status='completed' or comparison is null),check(status<>'completed' or coalesce(jsonb_typeof(comparison)='object',false))
);
create table public.analysis_representative_human_test_items (
 test_id uuid not null references public.analysis_representative_human_tests(id),review_id uuid not null,position integer not null check(position between 1 and 12),analysis_text_sha256 text not null check(analysis_text_sha256~'^[a-f0-9]{64}$'),selection_rank_hash text not null check(selection_rank_hash~'^[a-f0-9]{64}$'),
 excluded boolean not null default false,exclusion_reason text,confirmed_at timestamptz,confirmed_by uuid references auth.users(id),created_at timestamptz not null default now(),primary key(test_id,review_id),check((excluded and exclusion_reason='translation_issue') or (not excluded and exclusion_reason is null))
);
create unique index representative_active_positions on public.analysis_representative_human_test_items(test_id,position) where not excluded;
create table public.analysis_representative_human_labels (
 test_id uuid not null,review_id uuid not null,theme_key text not null,choice text not null check(choice in ('absent','positive','negative','both','uncertain')),annotator_user_id uuid not null references auth.users(id),updated_at timestamptz not null default now(),
 primary key(test_id,review_id,theme_key),foreign key(test_id,review_id) references public.analysis_representative_human_test_items(test_id,review_id)
);
create table public.analysis_representative_human_events (
 id bigint generated always as identity primary key,test_id uuid not null references public.analysis_representative_human_tests(id),actor_user_id uuid not null references auth.users(id),action text not null check(action in ('created','confirmed_review','excluded_review','completed')),review_id uuid,payload jsonb not null default '{}',created_at timestamptz not null default now()
);
create index corrected_reference_org on public.analysis_corrected_references(organization_id);
create index representative_org_created on public.analysis_representative_human_tests(organization_id,created_at desc);
create index representative_events_parent on public.analysis_representative_human_events(test_id,id);
alter table public.analysis_corrected_references enable row level security;
alter table public.analysis_corrected_reference_labels enable row level security;
alter table public.analysis_representative_human_tests enable row level security;
alter table public.analysis_representative_human_test_items enable row level security;
alter table public.analysis_representative_human_labels enable row level security;
alter table public.analysis_representative_human_events enable row level security;
revoke all on public.analysis_corrected_references,public.analysis_corrected_reference_labels,public.analysis_representative_human_tests,public.analysis_representative_human_test_items,public.analysis_representative_human_labels,public.analysis_representative_human_events from public,anon,authenticated;
grant all on public.analysis_corrected_references,public.analysis_corrected_reference_labels,public.analysis_representative_human_tests,public.analysis_representative_human_test_items,public.analysis_representative_human_labels,public.analysis_representative_human_events to service_role;
grant usage,select on sequence public.analysis_representative_human_events_id_seq to service_role;
create policy corrected_reference_org_read on public.analysis_corrected_references for select to authenticated using((select private.has_org_role(organization_id,array['owner','admin','manager'])));
create policy corrected_labels_org_read on public.analysis_corrected_reference_labels for select to authenticated using(exists(select 1 from public.analysis_corrected_references r where r.id=reference_id and private.has_org_role(r.organization_id,array['owner','admin','manager'])));
create policy representative_org_read on public.analysis_representative_human_tests for select to authenticated using((select private.has_org_role(organization_id,array['owner','admin','manager'])));
create policy representative_items_org_read on public.analysis_representative_human_test_items for select to authenticated using(exists(select 1 from public.analysis_representative_human_tests t where t.id=test_id and private.has_org_role(t.organization_id,array['owner','admin','manager'])));
create policy representative_labels_org_read on public.analysis_representative_human_labels for select to authenticated using(exists(select 1 from public.analysis_representative_human_tests t where t.id=test_id and private.has_org_role(t.organization_id,array['owner','admin','manager'])));
create policy representative_events_org_read on public.analysis_representative_human_events for select to authenticated using(exists(select 1 from public.analysis_representative_human_tests t where t.id=test_id and private.has_org_role(t.organization_id,array['owner','admin','manager'])));

create function public.corrected_reference_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare state text;
begin
 if tg_table_name='analysis_corrected_references' then if old.status='completed' then raise exception 'REFERENCE_IMMUTABLE';end if;
 else
  if tg_op in ('UPDATE','DELETE') then select status into state from public.analysis_corrected_references where id=old.reference_id for update;if state='completed' then raise exception 'REFERENCE_IMMUTABLE';end if;end if;
  if tg_op='UPDATE' and (new.reference_id<>old.reference_id or new.review_id<>old.review_id or new.theme_key<>old.theme_key) then raise exception 'REFERENCE_IMMUTABLE';end if;
  select status into state from public.analysis_corrected_references where id=case when tg_op='DELETE' then old.reference_id else new.reference_id end for update;if state='completed' then raise exception 'REFERENCE_IMMUTABLE';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger corrected_reference_immutable before update or delete on public.analysis_corrected_references for each row execute function public.corrected_reference_guard();
create trigger corrected_reference_labels_immutable before insert or update or delete on public.analysis_corrected_reference_labels for each row execute function public.corrected_reference_guard();
create function public.representative_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare state text;
begin
 if tg_table_name='analysis_representative_human_tests' then
  if old.status='completed' then raise exception 'HOLDOUT_IMMUTABLE';end if;
  if tg_op='UPDATE' and (to_jsonb(old)-array['status','completed_at','comparison','revision']) is distinct from (to_jsonb(new)-array['status','completed_at','comparison','revision']) then raise exception 'HOLDOUT_METADATA_IMMUTABLE';end if;
 else
  if tg_table_name='analysis_representative_human_events' and tg_op<>'INSERT' then raise exception 'HOLDOUT_AUDIT_IMMUTABLE';end if;
  if tg_op in ('UPDATE','DELETE') then select status into state from public.analysis_representative_human_tests where id=old.test_id for update;if state='completed' then raise exception 'HOLDOUT_IMMUTABLE';end if;end if;
  if tg_op='UPDATE' and (new.test_id<>old.test_id or new.review_id<>old.review_id) then raise exception 'HOLDOUT_METADATA_IMMUTABLE';end if;
  if tg_table_name='analysis_representative_human_labels' then
   if tg_op='UPDATE' and new.theme_key<>old.theme_key then raise exception 'HOLDOUT_METADATA_IMMUTABLE';end if;
  end if;
  if tg_op='UPDATE' and tg_table_name='analysis_representative_human_test_items' and (to_jsonb(old)-array['excluded','exclusion_reason','confirmed_at','confirmed_by']) is distinct from (to_jsonb(new)-array['excluded','exclusion_reason','confirmed_at','confirmed_by']) then raise exception 'HOLDOUT_METADATA_IMMUTABLE';end if;
  select status into state from public.analysis_representative_human_tests where id=case when tg_op='DELETE' then old.test_id else new.test_id end for update;if state='completed' then raise exception 'HOLDOUT_IMMUTABLE';end if;
  if tg_table_name='analysis_representative_human_labels' and tg_op<>'DELETE' then
   if not exists(select 1 from public.analysis_representative_human_tests t where t.id=new.test_id and t.taxonomy ? new.theme_key) then raise exception 'HOLDOUT_THEME_INVALID';end if;
  end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger representative_immutable before update or delete on public.analysis_representative_human_tests for each row execute function public.representative_guard();
create trigger representative_items_immutable before insert or update or delete on public.analysis_representative_human_test_items for each row execute function public.representative_guard();
create trigger representative_labels_immutable before insert or update or delete on public.analysis_representative_human_labels for each row execute function public.representative_guard();
create trigger representative_events_immutable before insert or update or delete on public.analysis_representative_human_events for each row execute function public.representative_guard();
revoke all on function public.corrected_reference_guard(),public.representative_guard() from public,anon,authenticated;

create function public.create_corrected_gold_reference(p_user uuid,p_gold uuid,p_adjudication uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare g public.analysis_gold_sets;a public.analysis_gold_adjudications;result uuid;total integer;overrides integer;uncertain_count integer;
begin
 if p_gold is distinct from '1d5cfc8c-ac77-4e44-a7a7-6153eb132385'::uuid or p_adjudication is distinct from '146615ca-d3cd-4914-8613-4e6e3d6219f7'::uuid then raise exception 'REFERENCE_SOURCE_INVALID';end if;
 select * into g from public.analysis_gold_sets where id=p_gold and status='completed';select * into a from public.analysis_gold_adjudications where id=p_adjudication and status='completed';
 if g.id is null or a.id is null or a.gold_set_id<>g.id or a.organization_id<>g.organization_id or a.source_generation_id<>g.source_generation_id or a.jev_benchmark_id<>g.jev_benchmark_id or g.taxonomy_version<>'gold-taxonomy-v1' then raise exception 'REFERENCE_SOURCE_INVALID';end if;
 if not exists(select 1 from public.organization_members where organization_id=g.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('corrected-reference:'||p_gold::text||':'||p_adjudication::text,0));
 select id into result from public.analysis_corrected_references where source_gold_set_id=g.id and source_adjudication_id=a.id and name='shabu-v7-gold-v2-assisted';if found then return result;end if;
 select count(*) into total from public.analysis_gold_labels where gold_set_id=g.id;if total<>1000 then raise exception 'REFERENCE_LABELS_INCOMPLETE';end if;
 select count(*),count(*) filter(where choice='uncertain') into overrides,uncertain_count from public.analysis_gold_adjudication_labels where adjudication_id=a.id;
 if overrides<>(select sum(jsonb_array_length(themes)) from public.analysis_gold_adjudication_items where adjudication_id=a.id) or exists(select 1 from public.analysis_gold_adjudication_labels h where h.adjudication_id=a.id and not exists(select 1 from public.analysis_gold_labels l where l.gold_set_id=g.id and l.review_id=h.review_id and l.theme_key=h.theme_key)) then raise exception 'REFERENCE_LABELS_INCOMPLETE';end if;
 insert into public.analysis_corrected_references(organization_id,establishment_id,source_gold_set_id,source_adjudication_id,source_generation_id,jev_benchmark_id,name,methodology,taxonomy_version,taxonomy,status,created_by,source_fingerprint)
 values(g.organization_id,g.establishment_id,g.id,a.id,g.source_generation_id,g.jev_benchmark_id,'shabu-v7-gold-v2-assisted','human_corrected_reference_v2',g.taxonomy_version,g.taxonomy,'building',p_user,encode(extensions.digest(to_jsonb(g)::text||to_jsonb(a)::text,'sha256'),'hex')) returning id into result;
 insert into public.analysis_corrected_reference_labels(reference_id,review_id,theme_key,choice,source,source_gold_set_id,source_adjudication_id,annotator_user_id,source_updated_at)
 select result,l.review_id,l.theme_key,coalesce(h.choice,l.choice),case when h.theme_key is null then 'gold_v1' else 'human_adjudication' end,g.id,case when h.theme_key is null then null else a.id end,coalesce(h.annotator_user_id,l.annotator_user_id),coalesce(h.updated_at,l.updated_at)
 from public.analysis_gold_labels l left join public.analysis_gold_adjudication_labels h on h.adjudication_id=a.id and h.review_id=l.review_id and h.theme_key=l.theme_key where l.gold_set_id=g.id;
 update public.analysis_corrected_references set status='completed',completed_at=now(),label_count=total,human_label_count=overrides,human_comparable_count=overrides-uncertain_count,human_uncertain_count=uncertain_count where id=result;
 return result;
end $$;

create function public.create_representative_human_test(p_user uuid,p_reference uuid,p_items jsonb,p_stats jsonb,p_seed text,p_fingerprint text) returns uuid language plpgsql security invoker set search_path='' as $$
declare r public.analysis_corrected_references;result uuid;item jsonb;actual_text text;
begin
 select * into r from public.analysis_corrected_references where id=p_reference and status='completed' and name='shabu-v7-gold-v2-assisted';
 if r.id is null or not exists(select 1 from public.organization_members where organization_id=r.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('representative:'||r.source_generation_id::text,0));
 select id into result from public.analysis_representative_human_tests where source_generation_id=r.source_generation_id and organization_id=r.organization_id and name='shabu-v7-representative-holdout-v1';if found then return result;end if;
 if jsonb_array_length(p_items)<>12 or (select count(distinct x->>'review_id') from jsonb_array_elements(p_items) x)<>12 or p_seed<>r.source_generation_id::text||':representative-holdout-v1:' then raise exception 'HOLDOUT_SELECTION_INVALID';end if;
 insert into public.analysis_representative_human_tests(organization_id,establishment_id,source_generation_id,gold_v1_id,gold_v2_reference_id,previous_adjudication_id,jev_benchmark_id,methodology,selection_method,selection_seed,candidate_count,pool_stats,selected_review_ids,taxonomy_version,taxonomy,target_reviews,created_by,source_fingerprint)
 values(r.organization_id,r.establishment_id,r.source_generation_id,r.source_gold_set_id,r.id,r.source_adjudication_id,r.jev_benchmark_id,'representative_holdout_v1','sha256_source_review_v1',p_seed,(p_stats->>'eligible_holdout_reviews')::integer,p_stats,(select jsonb_agg(x->>'review_id' order by (x->>'position')::integer) from jsonb_array_elements(p_items) x),r.taxonomy_version,r.taxonomy,12,p_user,p_fingerprint) returning id into result;
 for item in select * from jsonb_array_elements(p_items) loop
  if exists(select 1 from public.analysis_gold_set_reviews where gold_set_id=r.source_gold_set_id and review_id=(item->>'review_id')::uuid) or exists(select 1 from public.analysis_gold_adjudication_items where adjudication_id=r.source_adjudication_id and review_id=(item->>'review_id')::uuid) then raise exception 'HOLDOUT_ALREADY_SEEN';end if;
  select x->>'analysis_text' into actual_text from public.historical_report_runs h cross join lateral jsonb_array_elements(h.snapshot->'reviews') x where h.generation_id=r.source_generation_id and x->>'id'=item->>'review_id' and x->>'analysis_language'='en';
  if actual_text is null or btrim(actual_text)='' or encode(extensions.digest(actual_text,'sha256'),'hex')<>item->>'analysis_text_sha256' or encode(extensions.digest(p_seed||(item->>'review_id'),'sha256'),'hex')<>item->>'selection_rank_hash' then raise exception 'HOLDOUT_TEXT_CHANGED';end if;
  insert into public.analysis_representative_human_test_items(test_id,review_id,position,analysis_text_sha256,selection_rank_hash) values(result,(item->>'review_id')::uuid,(item->>'position')::integer,item->>'analysis_text_sha256',item->>'selection_rank_hash');
 end loop;
 insert into public.analysis_representative_human_events(test_id,actor_user_id,action) values(result,p_user,'created');return result;
end $$;

create function public.write_representative_human_test(p_user uuid,p_id uuid,p_revision integer,p_action text,p_payload jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare t public.analysis_representative_human_tests;it public.analysis_representative_human_test_items;label record;previous_labels jsonb;actual_text text;
begin
 select * into t from public.analysis_representative_human_tests where id=p_id for update;
 if t.id is null or not exists(select 1 from public.organization_members where organization_id=t.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if t.status<>'draft' then raise exception 'HOLDOUT_IMMUTABLE';end if;if t.revision is distinct from p_revision then raise exception 'HOLDOUT_REVISION_CHANGED';end if;
 if p_action in ('confirm_review','exclude_review') then
  select * into it from public.analysis_representative_human_test_items where test_id=p_id and review_id=(p_payload->>'review_id')::uuid and not excluded;if it.review_id is null then raise exception 'HOLDOUT_REVIEW_INVALID';end if;
  if p_action='confirm_review' then
   if (select count(*) from jsonb_object_keys(p_payload->'choices'))<>25 then raise exception 'HOLDOUT_CHOICES_INVALID';end if;
   select jsonb_object_agg(theme_key,choice) into previous_labels from public.analysis_representative_human_labels where test_id=p_id and review_id=it.review_id;
   for label in select * from jsonb_each_text(p_payload->'choices') loop
    insert into public.analysis_representative_human_labels(test_id,review_id,theme_key,choice,annotator_user_id) values(p_id,it.review_id,label.key,label.value,p_user) on conflict(test_id,review_id,theme_key) do update set choice=excluded.choice,annotator_user_id=p_user,updated_at=now();
   end loop;
   update public.analysis_representative_human_test_items set confirmed_at=now(),confirmed_by=p_user where test_id=p_id and review_id=it.review_id;
   insert into public.analysis_representative_human_events(test_id,actor_user_id,action,review_id,payload) values(p_id,p_user,'confirmed_review',it.review_id,jsonb_build_object('previous',previous_labels,'choices',p_payload->'choices'));
  else
   if exists(select 1 from public.analysis_gold_set_reviews where gold_set_id=t.gold_v1_id and review_id=(p_payload->'replacement'->>'review_id')::uuid) or exists(select 1 from public.analysis_gold_adjudication_items where adjudication_id=t.previous_adjudication_id and review_id=(p_payload->'replacement'->>'review_id')::uuid) then raise exception 'HOLDOUT_ALREADY_SEEN';end if;
   select x->>'analysis_text' into actual_text from public.historical_report_runs h cross join lateral jsonb_array_elements(h.snapshot->'reviews') x where h.generation_id=t.source_generation_id and x->>'id'=p_payload->'replacement'->>'review_id' and x->>'analysis_language'='en';
   if actual_text is null or btrim(actual_text)='' or encode(extensions.digest(actual_text,'sha256'),'hex')<>p_payload->'replacement'->>'analysis_text_sha256' or encode(extensions.digest(t.selection_seed||(p_payload->'replacement'->>'review_id'),'sha256'),'hex')<>p_payload->'replacement'->>'selection_rank_hash' then raise exception 'HOLDOUT_TEXT_CHANGED';end if;
   update public.analysis_representative_human_test_items set excluded=true,exclusion_reason='translation_issue' where test_id=p_id and review_id=it.review_id;
   insert into public.analysis_representative_human_test_items(test_id,review_id,position,analysis_text_sha256,selection_rank_hash) values(p_id,(p_payload->'replacement'->>'review_id')::uuid,it.position,p_payload->'replacement'->>'analysis_text_sha256',p_payload->'replacement'->>'selection_rank_hash');
   insert into public.analysis_representative_human_events(test_id,actor_user_id,action,review_id,payload) values(p_id,p_user,'excluded_review',it.review_id,jsonb_build_object('reason','translation_issue','replacement_review_id',p_payload->'replacement'->>'review_id'));
  end if;
 elsif p_action='finalize' then
  if (select count(*) from public.analysis_representative_human_test_items where test_id=p_id and not excluded)<>12 or exists(select 1 from public.analysis_representative_human_test_items item where item.test_id=p_id and not item.excluded and (item.confirmed_at is null or (select count(*) from public.analysis_representative_human_labels l where l.test_id=p_id and l.review_id=item.review_id)<>25)) then raise exception 'HOLDOUT_INCOMPLETE';end if;
  if coalesce(jsonb_typeof(p_payload->'comparison'),'null')<>'object' then raise exception 'HOLDOUT_COMPARISON_REQUIRED';end if;
  insert into public.analysis_representative_human_events(test_id,actor_user_id,action) values(p_id,p_user,'completed');update public.analysis_representative_human_tests set status='completed',completed_at=now(),comparison=p_payload->'comparison',revision=revision+1 where id=p_id;return t.revision+1;
 else raise exception 'HOLDOUT_ACTION_INVALID';end if;
 update public.analysis_representative_human_tests set revision=revision+1 where id=p_id;return t.revision+1;
end $$;
revoke all on function public.create_corrected_gold_reference(uuid,uuid,uuid),public.create_representative_human_test(uuid,uuid,jsonb,jsonb,text,text),public.write_representative_human_test(uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_corrected_gold_reference(uuid,uuid,uuid),public.create_representative_human_test(uuid,uuid,jsonb,jsonb,text,text),public.write_representative_human_test(uuid,uuid,integer,text,jsonb) to service_role;
