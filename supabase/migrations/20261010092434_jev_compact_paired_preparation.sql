-- Separate preparation and blinded references. No paid authorization or JEV run is seeded.
create table public.analysis_jev_compact_sets(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),name text not null default 'compact-paired-new-reviews-v1',
 status text not null default 'draft' check(status in ('draft','sealed')),selection_method text not null,selection_seed text not null,candidate_stats jsonb not null,
 configuration_a text not null references public.analysis_jev_economy_configurations(id),configuration_b text not null references public.analysis_jev_economy_configurations(id),
 configuration_a_sha256 text not null,configuration_b_sha256 text not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),sealed_at timestamptz,unique(organization_id,name)
);
create index compact_sets_creator on public.analysis_jev_compact_sets(created_by);
create index compact_sets_config_a on public.analysis_jev_compact_sets(configuration_a);
create index compact_sets_config_b on public.analysis_jev_compact_sets(configuration_b);
create table public.analysis_jev_compact_items(
 set_id uuid not null references public.analysis_jev_compact_sets(id),review_id uuid not null references public.reviews(id),organization_id uuid not null references public.organizations(id),
 establishment_id uuid not null references public.establishments(id),establishment_name text not null,position integer not null check(position between 1 and 32),overall_rating integer not null check(overall_rating between 1 and 5),
 original_text text not null check(btrim(original_text)<>''),original_language text,original_text_sha256 text not null check(original_text_sha256~'^[a-f0-9]{64}$'),
 selection_bucket text not null check(selection_bucket in ('low','four','five')),selection_hash text not null,text_id uuid,created_at timestamptz not null default now(),
 primary key(set_id,review_id),unique(set_id,position),unique(organization_id,review_id)
);
create index compact_items_review on public.analysis_jev_compact_items(review_id);
create index compact_items_establishment on public.analysis_jev_compact_items(establishment_id);
create table public.analysis_jev_compact_texts(
 id uuid primary key default gen_random_uuid(),set_id uuid not null,review_id uuid not null,organization_id uuid not null references public.organizations(id),
 original_text_sha256 text not null,analysis_text text not null check(btrim(analysis_text)<>''),analysis_text_sha256 text not null check(analysis_text_sha256~'^[a-f0-9]{64}$'),
 language text not null check(language='en'),source text not null check(source in ('original_en','google_translation_en','manual_chatgpt_translation_en','manual_verified_translation_en')),
 model_source text,provenance jsonb not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(set_id,review_id) references public.analysis_jev_compact_items(set_id,review_id),unique(set_id,review_id,analysis_text_sha256),check(source not in ('manual_chatgpt_translation_en','manual_verified_translation_en') or btrim(model_source)<>'')
);
create index compact_texts_org on public.analysis_jev_compact_texts(organization_id,set_id);
create index compact_texts_creator on public.analysis_jev_compact_texts(created_by);
alter table public.analysis_jev_compact_items add foreign key(text_id) references public.analysis_jev_compact_texts(id);
create index compact_items_text on public.analysis_jev_compact_items(text_id) where text_id is not null;
create table public.analysis_jev_compact_ai_references(
 set_id uuid not null,review_id uuid not null,organization_id uuid not null references public.organizations(id),theme_key text not null,
 choice text not null check(choice in ('absent','positive','negative','both','uncertain')),analysis_text_sha256 text not null,model_source text not null check(btrim(model_source)<>''),
 annotation_protocol text not null check(annotation_protocol='blind_to_jev_predictions'),reference_type text not null check(reference_type='ai_reference_not_human_gold'),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),primary key(set_id,review_id,theme_key),foreign key(set_id,review_id) references public.analysis_jev_compact_items(set_id,review_id)
);
create index compact_references_org on public.analysis_jev_compact_ai_references(organization_id,set_id);
create index compact_references_creator on public.analysis_jev_compact_ai_references(created_by);
create table public.analysis_jev_compact_seals(
 set_id uuid primary key references public.analysis_jev_compact_sets(id),organization_id uuid not null references public.organizations(id),dataset_sha256 text not null,reference_sha256 text not null,
 configuration_a_sha256 text not null,configuration_b_sha256 text not null,uncertain_labels integer not null,created_by uuid not null references auth.users(id),sealed_at timestamptz not null default now()
);
create index compact_seals_org on public.analysis_jev_compact_seals(organization_id);
create index compact_seals_creator on public.analysis_jev_compact_seals(created_by);
create table public.analysis_jev_compact_authorizations(
 set_id uuid primary key references public.analysis_jev_compact_sets(id),organization_id uuid not null references public.organizations(id),authorized_by uuid not null references auth.users(id),authorized_at timestamptz not null,
 dataset_sha256 text not null,reference_sha256 text not null,configuration_a_sha256 text not null,configuration_b_sha256 text not null,
 cost_limit_usd numeric not null check(cost_limit_usd>0),expected_served_model text not null check(expected_served_model<>'' and expected_served_model<>'jev-latest'),
 user_instruction text not null check(btrim(user_instruction)<>''),max_evaluations integer not null check(max_evaluations=64)
);
create index compact_authorizations_org on public.analysis_jev_compact_authorizations(organization_id);
create index compact_authorizations_actor on public.analysis_jev_compact_authorizations(authorized_by);
create table public.analysis_jev_compact_runs(
 id uuid primary key default gen_random_uuid(),set_id uuid not null unique references public.analysis_jev_compact_sets(id),organization_id uuid not null references public.organizations(id),
 status text not null default 'queued' check(status in ('queued','running','completed','failed')),created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 started_at timestamptz,completed_at timestamptz,rates jsonb not null,expected_served_model text not null,estimated_cost_usd numeric,cost_limit_usd numeric not null,seal jsonb not null,
 cost_confirmed_at timestamptz not null,lease_owner uuid,lease_until timestamptz,error_code text
);
create index compact_runs_org on public.analysis_jev_compact_runs(organization_id);
create index compact_runs_creator on public.analysis_jev_compact_runs(created_by);
create table public.analysis_jev_compact_tasks(
 id uuid primary key default gen_random_uuid(),run_id uuid not null references public.analysis_jev_compact_runs(id),review_id uuid not null references public.reviews(id),variant text not null check(variant in ('A','B')),
 configuration_id text not null references public.analysis_jev_economy_configurations(id),analysis_text_sha256 text not null,repeat integer not null default 1 check(repeat=1),
 status text not null default 'pending' check(status in ('pending','running','completed','failed')),cache_id uuid references public.analysis_jev_review_cache(id),reused boolean not null default false,
 response jsonb,served_model text,input_tokens bigint not null default 0,output_tokens bigint not null default 0,cost_usd numeric not null default 0,duration_ms bigint not null default 0,
 request_count integer not null default 0 check(request_count between 0 and 1),retry_count integer not null default 0 check(retry_count=0),usage_complete boolean not null default true,error_code text,lease_owner uuid,
 started_at timestamptz,completed_at timestamptz,unique(run_id,review_id,variant)
);
create index compact_tasks_review on public.analysis_jev_compact_tasks(review_id);
create index compact_tasks_config on public.analysis_jev_compact_tasks(configuration_id);
create index compact_tasks_cache on public.analysis_jev_compact_tasks(cache_id) where cache_id is not null;
create table public.analysis_jev_compact_results(run_id uuid primary key references public.analysis_jev_compact_runs(id),organization_id uuid not null references public.organizations(id),comparison jsonb not null,created_at timestamptz not null default now(),check(comparison->>'human_validated'='false' and comparison->>'production_enabled'='false'));
create index compact_results_org on public.analysis_jev_compact_results(organization_id);
create table public.analysis_jev_compact_events(id bigint generated always as identity primary key,set_id uuid not null references public.analysis_jev_compact_sets(id),organization_id uuid not null references public.organizations(id),actor_id uuid references auth.users(id),action text not null,details jsonb not null default '{}',created_at timestamptz not null default now());
create index compact_events_org on public.analysis_jev_compact_events(organization_id,set_id);
create index compact_events_set on public.analysis_jev_compact_events(set_id);
create index compact_events_actor on public.analysis_jev_compact_events(actor_id) where actor_id is not null;
do $$declare t text;begin foreach t in array array['analysis_jev_compact_sets','analysis_jev_compact_items','analysis_jev_compact_texts','analysis_jev_compact_ai_references','analysis_jev_compact_seals','analysis_jev_compact_authorizations','analysis_jev_compact_runs','analysis_jev_compact_tasks','analysis_jev_compact_results','analysis_jev_compact_events'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);execute format('grant all on public.%I to service_role',t);
 if t='analysis_jev_compact_tasks' then execute format('create policy compact_read on public.%I for select to authenticated using(exists(select 1 from public.analysis_jev_compact_runs r join public.organization_members m on m.organization_id=r.organization_id where r.id=run_id and m.user_id=(select auth.uid()) and m.role in (''owner'',''admin'',''manager'')))',t);
 else execute format('create policy compact_read on public.%I for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=%I.organization_id and m.user_id=(select auth.uid()) and m.role in (''owner'',''admin'',''manager'')))',t,t);end if;
end loop;end $$;
grant usage,select on sequence public.analysis_jev_compact_events_id_seq to service_role;
create function public.compact_used_review_ids(p_org uuid) returns setof uuid language sql stable security invoker set search_path='' as $$
 select public.jev_v13_used_review_ids(p_org,null)
 union select review_id from public.analysis_jev_review_cache where organization_id=p_org
 union select i.review_id from public.analysis_v11_independent_holdout_items i join public.analysis_v11_independent_holdout_sets s on s.id=i.holdout_id where s.organization_id=p_org
 union select (i->>'review_id')::uuid from public.analysis_jev_v12_runs r cross join lateral jsonb_array_elements(r.prepared->'items') i where r.organization_id=p_org
 union select (i->>'review_id')::uuid from public.analysis_negative_ai_exploratory_runs r cross join lateral jsonb_array_elements(r.dataset_snapshot) i where r.organization_id=p_org
 union select a.review_id from public.analysis_jev_v12_ai_miss_audits a join public.reviews r on r.id=a.review_id where r.organization_id=p_org
 union select a.review_id from public.analysis_jev_v13_fresh_posthoc_ai_audits a join public.reviews r on r.id=a.review_id where r.organization_id=p_org
 union select a.review_id from public.analysis_jev_v13_fresh_ai_reference_notes a join public.reviews r on r.id=a.review_id where r.organization_id=p_org
 union select i.review_id from public.analysis_jev_compact_items i where i.organization_id=p_org
 union select (coalesce(x->>'id',x->>'review_id'))::uuid from public.historical_report_runs h join public.establishments e on e.id=h.establishment_id cross join lateral jsonb_array_elements(h.snapshot->'reviews') x where e.organization_id=p_org and (h.snapshot->>'analysis_version')::int between 9 and 13
$$;
create function public.compact_candidates(p_org uuid) returns table(review_id uuid,establishment_id uuid,establishment_name text,organization_id uuid,overall_rating integer,original_text text,original_language text,english_text text,english_source text,translation_id uuid) language sql stable security invoker set search_path='' as $$
 with used as materialized(select public.compact_used_review_ids(p_org) id)
 select r.id,r.establishment_id,e.name,r.organization_id,r.rating::integer,r.original_text,r.original_language,
 case when lower(r.original_language)='en' then r.original_text else t.translated_text end,
 case when lower(r.original_language)='en' then 'original_en' when t.id is not null then 'google_translation_en' else null end,t.id
 from public.reviews r join public.establishments e on e.id=r.establishment_id
 left join lateral(select tr.id,tr.translated_text from public.review_translations tr where tr.review_id=r.id and tr.language='en' and btrim(tr.translated_text)<>'' order by tr.created_at desc,tr.id limit 1) t on true
 where r.organization_id=p_org and e.organization_id=p_org and e.active and btrim(coalesce(r.original_text,''))<>'' and r.rating between 1 and 5 and not exists(select 1 from used u where u.id=r.id)
$$;
create function public.compact_candidate_inventory(p_org uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 with c as materialized(select * from public.compact_candidates(p_org))
 select jsonb_build_object('total',count(*),'english_ready',count(*) filter(where english_text is not null),'missing_english',count(*) filter(where english_text is null),
 'buckets',jsonb_build_object('low',jsonb_build_object('total',count(*) filter(where overall_rating<=3),'english_ready',count(*) filter(where overall_rating<=3 and english_text is not null)),'four',jsonb_build_object('total',count(*) filter(where overall_rating=4),'english_ready',count(*) filter(where overall_rating=4 and english_text is not null)),'five',jsonb_build_object('total',count(*) filter(where overall_rating=5),'english_ready',count(*) filter(where overall_rating=5 and english_text is not null))),
 'establishments',(select jsonb_agg(to_jsonb(e) order by e.name) from (select establishment_id id,establishment_name name,count(*) total,count(*) filter(where english_text is not null) english_ready,count(*) filter(where overall_rating<=3) low,count(*) filter(where overall_rating=4) four,count(*) filter(where overall_rating=5) five from c group by establishment_id,establishment_name) e)) from c
$$;
revoke all on function public.compact_candidate_inventory(uuid) from public,anon,authenticated;
grant execute on function public.compact_candidate_inventory(uuid) to service_role;

create function public.compact_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare s public.analysis_jev_compact_sets; i public.analysis_jev_compact_items;begin
 if tg_table_name in ('analysis_jev_compact_seals','analysis_jev_compact_results','analysis_jev_compact_events','analysis_jev_compact_authorizations') then raise exception 'COMPACT_IMMUTABLE';end if;
 if tg_table_name='analysis_jev_compact_sets' then if tg_op='UPDATE' and old.status='draft' and new.status='sealed' and to_jsonb(new)-array['status','sealed_at']=to_jsonb(old)-array['status','sealed_at'] then return new;end if;raise exception 'COMPACT_SET_IMMUTABLE';end if;
 if tg_table_name='analysis_jev_compact_runs' then if tg_op='DELETE' or old.status in ('completed','failed') or to_jsonb(new)-array['status','started_at','completed_at','lease_owner','lease_until','error_code']<>to_jsonb(old)-array['status','started_at','completed_at','lease_owner','lease_until','error_code'] then raise exception 'COMPACT_RUN_IMMUTABLE';end if;return new;end if;
 if tg_table_name='analysis_jev_compact_tasks' then if tg_op='DELETE' or old.status in ('completed','failed') or to_jsonb(new)-array['status','cache_id','reused','response','served_model','input_tokens','output_tokens','cost_usd','duration_ms','request_count','usage_complete','error_code','lease_owner','started_at','completed_at']<>to_jsonb(old)-array['status','cache_id','reused','response','served_model','input_tokens','output_tokens','cost_usd','duration_ms','request_count','usage_complete','error_code','lease_owner','started_at','completed_at'] then raise exception 'COMPACT_TASK_IMMUTABLE';end if;return new;end if;
 select * into s from public.analysis_jev_compact_sets where id=new.set_id;
 if tg_op='DELETE' or s.status='sealed' then raise exception 'COMPACT_SEALED_IMMUTABLE';end if;
 if tg_table_name='analysis_jev_compact_items' then if tg_op='UPDATE' and to_jsonb(new)-'text_id'=to_jsonb(old)-'text_id' and not exists(select 1 from public.analysis_jev_compact_ai_references where set_id=new.set_id) then return new;end if;raise exception 'COMPACT_ITEMS_IMMUTABLE';end if;
 if tg_op='UPDATE' then raise exception 'COMPACT_REFERENCE_IMMUTABLE';end if;
 select * into i from public.analysis_jev_compact_items where set_id=new.set_id and review_id=new.review_id;
 if not found or new.organization_id<>s.organization_id then raise exception 'COMPACT_ORGANIZATION_MISMATCH';end if;
 if tg_table_name='analysis_jev_compact_texts' then
 if new.original_text_sha256<>i.original_text_sha256 or new.analysis_text_sha256<>encode(extensions.digest(new.analysis_text,'sha256'),'hex') then raise exception 'COMPACT_TRANSLATION_HASH_MISMATCH';end if;
 elsif tg_table_name='analysis_jev_compact_ai_references' then
 if not exists(select 1 from public.analysis_jev_compact_texts t where t.id=i.text_id and t.analysis_text_sha256=new.analysis_text_sha256) or not exists(select 1 from public.analysis_jev_economy_configurations c where c.id=s.configuration_a and c.config->'questions'?new.theme_key) then raise exception 'COMPACT_REFERENCE_INVALID';end if;
 end if;return new;end $$;
do $$declare t text;begin foreach t in array array['analysis_jev_compact_sets','analysis_jev_compact_items','analysis_jev_compact_runs','analysis_jev_compact_tasks','analysis_jev_compact_seals','analysis_jev_compact_results','analysis_jev_compact_events','analysis_jev_compact_authorizations'] loop execute format('create trigger compact_immutable before update or delete on public.%I for each row execute function public.compact_guard()',t);end loop;
 foreach t in array array['analysis_jev_compact_texts','analysis_jev_compact_ai_references'] loop execute format('create trigger compact_content_guard before insert or update or delete on public.%I for each row execute function public.compact_guard()',t);end loop;end $$;
create function public.prepare_compact_set(p_user uuid,p_org uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare sid uuid;s public.analysis_jev_compact_sets;row record;tid uuid;stats jsonb;seed text;begin
 if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':compact-paired-new-reviews-v1',0));select * into s from public.analysis_jev_compact_sets where organization_id=p_org and name='compact-paired-new-reviews-v1';if found then return s.id;end if;
 seed=p_org::text||':compact-paired-new-reviews-v1';
 stats=public.compact_candidate_inventory(p_org);
 if (stats->'buckets'->'low'->>'total')::int<17 or (stats->'buckets'->'four'->>'total')::int<11 or (stats->'buckets'->'five'->>'total')::int<4 then raise exception 'COMPACT_INSUFFICIENT_CANDIDATES';end if;
 insert into public.analysis_jev_compact_sets(organization_id,selection_method,selection_seed,candidate_stats,configuration_a,configuration_b,configuration_a_sha256,configuration_b_sha256,created_by)
 select p_org,'english_availability_then_sha256_star_buckets_round_robin_establishments_v1',seed,stats,a.id,b.id,a.config_sha256,b.config_sha256,p_user from public.analysis_jev_economy_configurations a cross join public.analysis_jev_economy_configurations b where a.id='v12_economy_1pass_v1' and b.id='v12_economy_compact_experimental_v1' and a.threshold_sha256=b.threshold_sha256 returning id into sid;if sid is null then raise exception 'COMPACT_CONFIG_REQUIRED';end if;
 for row in with candidates as materialized(select c.*,case when overall_rating<=3 then 'low' when overall_rating=4 then 'four' else 'five' end bucket,encode(extensions.digest(seed||':'||review_id::text,'sha256'),'hex') hash from public.compact_candidates(p_org) c),
 ranked as(select c.*,row_number() over(partition by bucket,establishment_id,(english_text is not null) order by hash,review_id) erank from candidates c),
 chosen as(select r.*,row_number() over(partition by bucket order by (english_text is not null) desc,erank,establishment_id,hash) brank from ranked r)
 select c.*,row_number() over(order by case bucket when 'low' then 0 when 'four' then 1 else 2 end,brank) pos from chosen c where brank<=case bucket when 'low' then 17 when 'four' then 11 else 4 end order by pos loop
 insert into public.analysis_jev_compact_items(set_id,review_id,organization_id,establishment_id,establishment_name,position,overall_rating,original_text,original_language,original_text_sha256,selection_bucket,selection_hash) values(sid,row.review_id,p_org,row.establishment_id,row.establishment_name,row.pos,row.overall_rating,row.original_text,row.original_language,encode(extensions.digest(row.original_text,'sha256'),'hex'),row.bucket,row.hash);
 if row.english_text is not null then insert into public.analysis_jev_compact_texts(set_id,review_id,organization_id,original_text_sha256,analysis_text,analysis_text_sha256,language,source,provenance,created_by) values(sid,row.review_id,p_org,encode(extensions.digest(row.original_text,'sha256'),'hex'),row.english_text,encode(extensions.digest(row.english_text,'sha256'),'hex'),'en',row.english_source,jsonb_build_object('provider_translation_id',row.translation_id,'provider_name',case when row.english_source='original_en' then 'review_original' else 'Google/Apify source, exact provider not recorded in legacy translation row' end),p_user) returning id into tid;update public.analysis_jev_compact_items set text_id=tid where set_id=sid and review_id=row.review_id;end if;
 end loop;
 if (select count(*) from public.analysis_jev_compact_items where set_id=sid)<>32 then raise exception 'COMPACT_SELECTION_INCOMPLETE';end if;
 insert into public.analysis_jev_compact_events(set_id,organization_id,actor_id,action,details) values(sid,p_org,p_user,'dataset_prepared_no_models',jsonb_build_object('reviews',32,'strata',jsonb_build_object('low',17,'four',11,'five',4),'new_paid_calls',0));return sid;end $$;
create function public.import_compact_texts(p_user uuid,p_set uuid,p_rows jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare s public.analysis_jev_compact_sets;i public.analysis_jev_compact_items;x jsonb;tid uuid;n integer=0;begin
 select * into s from public.analysis_jev_compact_sets where id=p_set for update;if not found or not exists(select 1 from public.organization_members where organization_id=s.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if s.status<>'draft' or exists(select 1 from public.analysis_jev_compact_ai_references where set_id=s.id) then raise exception 'COMPACT_TEXTS_LOCKED';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 32 or (select count(distinct x->>'review_id') from jsonb_array_elements(p_rows) x)<>jsonb_array_length(p_rows) then raise exception 'COMPACT_TRANSLATION_INVALID';end if;
 for x in select value from jsonb_array_elements(p_rows) loop
 select * into i from public.analysis_jev_compact_items where set_id=p_set and review_id=(x->>'review_id')::uuid;if not found or x->>'original_text_sha256' is distinct from i.original_text_sha256 or x->>'language' is distinct from 'en' or coalesce(x->>'source','') not in ('manual_chatgpt_translation_en','manual_verified_translation_en') or btrim(coalesce(x->>'model_source',''))='' or btrim(coalesce(x->>'analysis_text',''))='' or x->>'analysis_text_sha256' is distinct from encode(extensions.digest(x->>'analysis_text','sha256'),'hex') then raise exception 'COMPACT_TRANSLATION_HASH_MISMATCH';end if;
 insert into public.analysis_jev_compact_texts(set_id,review_id,organization_id,original_text_sha256,analysis_text,analysis_text_sha256,language,source,model_source,provenance,created_by) values(p_set,i.review_id,s.organization_id,i.original_text_sha256,x->>'analysis_text',x->>'analysis_text_sha256','en',x->>'source',x->>'model_source',coalesce(x->'provenance','{}'::jsonb),p_user) on conflict(set_id,review_id,analysis_text_sha256) do nothing;
 select id into tid from public.analysis_jev_compact_texts where set_id=p_set and review_id=i.review_id and analysis_text_sha256=x->>'analysis_text_sha256';update public.analysis_jev_compact_items set text_id=tid where set_id=p_set and review_id=i.review_id;n=n+1;
 end loop;insert into public.analysis_jev_compact_events(set_id,organization_id,actor_id,action,details) values(p_set,s.organization_id,p_user,'english_texts_imported_no_api',jsonb_build_object('rows',n));return n;end $$;
create function public.import_compact_references(p_user uuid,p_set uuid,p_rows jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare s public.analysis_jev_compact_sets;x jsonb;begin
 select * into s from public.analysis_jev_compact_sets where id=p_set for update;if not found or not exists(select 1 from public.organization_members where organization_id=s.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if s.status<>'draft' or exists(select 1 from public.analysis_jev_compact_runs where set_id=p_set) then raise exception 'COMPACT_REFERENCES_LOCKED';end if;
 if (select count(*) from public.analysis_jev_compact_items where set_id=p_set and text_id is not null)<>32 then raise exception 'COMPACT_ENGLISH_REQUIRED';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<>800 or (select count(distinct (x->>'review_id')||':'||(x->>'theme_key')) from jsonb_array_elements(p_rows) x)<>800 then raise exception 'COMPACT_AI_REFERENCE_REQUIRED';end if;
 if exists(select 1 from public.analysis_jev_compact_ai_references where set_id=p_set) then
 if exists(select 1 from jsonb_array_elements(p_rows) x left join public.analysis_jev_compact_ai_references r on r.set_id=p_set and r.review_id=(x->>'review_id')::uuid and r.theme_key=x->>'theme_key' where r.choice is distinct from x->>'choice' or r.analysis_text_sha256 is distinct from x->>'analysis_text_sha256' or r.model_source is distinct from x->>'model_source' or x->>'annotation_protocol' is distinct from r.annotation_protocol or x->>'reference_type' is distinct from r.reference_type) then raise exception 'COMPACT_REFERENCE_IMMUTABLE';end if;return 800;end if;
 for x in select value from jsonb_array_elements(p_rows) loop
 insert into public.analysis_jev_compact_ai_references(set_id,review_id,organization_id,theme_key,choice,analysis_text_sha256,model_source,annotation_protocol,reference_type,created_by) values(p_set,(x->>'review_id')::uuid,s.organization_id,x->>'theme_key',x->>'choice',x->>'analysis_text_sha256',x->>'model_source',x->>'annotation_protocol',x->>'reference_type',p_user);
 end loop;insert into public.analysis_jev_compact_events(set_id,organization_id,actor_id,action,details) values(p_set,s.organization_id,p_user,'blind_ai_references_imported',jsonb_build_object('labels',800,'human_gold',false));return 800;end $$;
create function public.compact_seal_fingerprints(p_set uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('dataset_sha256',encode(extensions.digest(public.jev_economy_canonical((select jsonb_agg(jsonb_build_object('review_id',i.review_id,'establishment_id',i.establishment_id,'position',i.position,'original_text_sha256',i.original_text_sha256,'analysis_text_sha256',t.analysis_text_sha256) order by i.position) from public.analysis_jev_compact_items i join public.analysis_jev_compact_texts t on t.id=i.text_id where i.set_id=p_set)),'sha256'),'hex'),
 'reference_sha256',encode(extensions.digest(public.jev_economy_canonical((select jsonb_agg(jsonb_build_object('set_id',r.set_id,'review_id',r.review_id,'theme_key',r.theme_key,'choice',r.choice,'analysis_text_sha256',r.analysis_text_sha256,'model_source',r.model_source,'annotation_protocol',r.annotation_protocol,'reference_type',r.reference_type) order by r.review_id::text,r.theme_key collate "C") from public.analysis_jev_compact_ai_references r where r.set_id=p_set)),'sha256'),'hex'))
$$;
create function public.seal_compact_set(p_user uuid,p_set uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.analysis_jev_compact_sets;fp jsonb;sealed public.analysis_jev_compact_seals;begin
 select * into s from public.analysis_jev_compact_sets where id=p_set for update;if not found or not exists(select 1 from public.organization_members where organization_id=s.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 select * into sealed from public.analysis_jev_compact_seals where set_id=p_set;if found then return to_jsonb(sealed);end if;
 if (select count(*) from public.analysis_jev_compact_items i join public.analysis_jev_compact_texts t on t.id=i.text_id where i.set_id=p_set and t.language='en' and t.original_text_sha256=i.original_text_sha256 and t.analysis_text_sha256=encode(extensions.digest(t.analysis_text,'sha256'),'hex') and i.original_text_sha256=encode(extensions.digest(i.original_text,'sha256'),'hex'))<>32 then raise exception 'COMPACT_ENGLISH_REQUIRED';end if;
 if (select count(*) from public.analysis_jev_compact_ai_references where set_id=p_set)<>800 then raise exception 'COMPACT_AI_REFERENCE_REQUIRED';end if;
 if exists(select 1 from public.analysis_jev_compact_items i where i.set_id=p_set and (i.review_id in (select public.jev_v13_used_review_ids(s.organization_id,null)) or exists(select 1 from public.analysis_jev_review_cache c where c.review_id=i.review_id and c.organization_id=s.organization_id))) then raise exception 'COMPACT_SAMPLE_ALREADY_ANALYZED';end if;
 fp=public.compact_seal_fingerprints(p_set);
 insert into public.analysis_jev_compact_seals(set_id,organization_id,dataset_sha256,reference_sha256,configuration_a_sha256,configuration_b_sha256,uncertain_labels,created_by) values(p_set,s.organization_id,fp->>'dataset_sha256',fp->>'reference_sha256',s.configuration_a_sha256,s.configuration_b_sha256,(select count(*) from public.analysis_jev_compact_ai_references where set_id=p_set and choice='uncertain'),p_user) returning * into sealed;
 update public.analysis_jev_compact_sets set status='sealed',sealed_at=sealed.sealed_at where id=p_set;insert into public.analysis_jev_compact_events(set_id,organization_id,actor_id,action,details) values(p_set,s.organization_id,p_user,'texts_and_ai_references_sealed_no_models',fp);return to_jsonb(sealed);end $$;
create function public.start_compact_run(p_user uuid,p_set uuid,p_confirm boolean,p_seal_sha text,p_rates jsonb,p_estimate numeric) returns uuid language plpgsql security invoker set search_path='' as $$
declare s public.analysis_jev_compact_sets;z public.analysis_jev_compact_seals;a public.analysis_jev_compact_authorizations;rid uuid;begin
 select * into s from public.analysis_jev_compact_sets where id=p_set for update;if not found or not exists(select 1 from public.organization_members where organization_id=s.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 select id into rid from public.analysis_jev_compact_runs where set_id=p_set;if found then return rid;end if;
 if p_confirm is distinct from true then raise exception 'COMPACT_COST_CONFIRMATION_REQUIRED';end if;
 select * into z from public.analysis_jev_compact_seals where set_id=p_set;if not found or s.status<>'sealed' then raise exception 'COMPACT_SEAL_REQUIRED';end if;
 if public.compact_seal_fingerprints(p_set)->>'dataset_sha256'<>z.dataset_sha256 or public.compact_seal_fingerprints(p_set)->>'reference_sha256'<>z.reference_sha256 or p_seal_sha<>z.reference_sha256 then raise exception 'COMPACT_SEAL_CHANGED';end if;
 select * into a from public.analysis_jev_compact_authorizations where set_id=p_set and organization_id=s.organization_id and dataset_sha256=z.dataset_sha256 and reference_sha256=z.reference_sha256 and configuration_a_sha256=z.configuration_a_sha256 and configuration_b_sha256=z.configuration_b_sha256;
 if not found then raise exception 'COMPACT_PAID_NOT_AUTHORIZED';end if;
 if (p_rates->>'input')::numeric<0 or (p_rates->>'output')::numeric<0 or p_estimate is null or p_estimate>a.cost_limit_usd then raise exception 'COMPACT_COST_LIMIT';end if;
 insert into public.analysis_jev_compact_runs(set_id,organization_id,created_by,rates,expected_served_model,estimated_cost_usd,cost_limit_usd,seal,cost_confirmed_at) values(p_set,s.organization_id,p_user,p_rates,a.expected_served_model,p_estimate,a.cost_limit_usd,to_jsonb(z)-array['organization_id','created_by'],now()) returning id into rid;
 insert into public.analysis_jev_compact_tasks(run_id,review_id,variant,configuration_id,analysis_text_sha256) select rid,i.review_id,v.variant,case v.variant when 'A' then s.configuration_a else s.configuration_b end,t.analysis_text_sha256 from public.analysis_jev_compact_items i join public.analysis_jev_compact_texts t on t.id=i.text_id cross join (values('A'),('B')) v(variant) where i.set_id=p_set;
 insert into public.analysis_jev_compact_events(set_id,organization_id,actor_id,action,details) values(p_set,s.organization_id,p_user,'manual_paid_start_confirmed',jsonb_build_object('run_id',rid,'max_evaluations',64));return rid;end $$;
-- Existing disabled economic cache remains disabled except for an explicitly
-- authorized new compact benchmark task. Historical completed cache rows stay immutable.
do $$declare src text;begin select pg_get_functiondef('public.jev_economy_guard()'::regprocedure) into src;
 src=replace(src,'if new.status=''dispatched'' then raise exception ''ECONOMY_PAID_ENGINE_DISABLED'';end if;',
 'if new.status=''dispatched'' and not exists(select 1 from public.analysis_jev_compact_tasks t join public.analysis_jev_compact_runs r on r.id=t.run_id join public.analysis_jev_compact_authorizations a on a.set_id=r.set_id where t.cache_id=new.id and t.status=''running'' and t.configuration_id=new.configuration_id and r.status=''running'' and a.organization_id=new.organization_id and r.organization_id=new.organization_id and r.cost_confirmed_at is not null and a.dataset_sha256=r.seal->>''dataset_sha256'' and a.reference_sha256=r.seal->>''reference_sha256'') then raise exception ''ECONOMY_PAID_ENGINE_DISABLED'';end if;');execute src;end $$;
revoke all on function public.compact_guard(),public.compact_used_review_ids(uuid),public.compact_candidates(uuid),public.prepare_compact_set(uuid,uuid),public.import_compact_texts(uuid,uuid,jsonb),public.import_compact_references(uuid,uuid,jsonb),public.compact_seal_fingerprints(uuid),public.seal_compact_set(uuid,uuid),public.start_compact_run(uuid,uuid,boolean,text,jsonb,numeric) from public,anon,authenticated;
grant execute on function public.compact_used_review_ids(uuid),public.compact_candidates(uuid),public.prepare_compact_set(uuid,uuid),public.import_compact_texts(uuid,uuid,jsonb),public.import_compact_references(uuid,uuid,jsonb),public.compact_seal_fingerprints(uuid),public.seal_compact_set(uuid,uuid),public.start_compact_run(uuid,uuid,boolean,text,jsonb,numeric) to service_role;
create function public.claim_compact_run(p_worker uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jev_compact_runs;begin perform pg_advisory_xact_lock(hashtextextended('compact-worker-v1',0));
 if exists(select 1 from public.analysis_jev_compact_runs where status='running' and lease_until>now()) then return null;end if;
 select q.* into r from public.analysis_jev_compact_runs q join public.analysis_jev_compact_authorizations a on a.set_id=q.set_id and a.dataset_sha256=q.seal->>'dataset_sha256' and a.reference_sha256=q.seal->>'reference_sha256'
 where q.status='queued' or(q.status='running' and (q.lease_until is null or q.lease_until<=now())) order by q.created_at for update of q skip locked limit 1;if not found then return null;end if;
 update public.analysis_jev_review_cache c set status='billing_uncertain',error_code='COMPACT_RESPONSE_UNCONFIRMED',processed_at=now(),usage_complete=false where c.status='dispatched' and c.id in (select cache_id from public.analysis_jev_compact_tasks where run_id=r.id and status='running');
 update public.analysis_jev_compact_tasks set status='failed',error_code='COMPACT_RESPONSE_UNCONFIRMED',usage_complete=false,request_count=1,completed_at=now() where run_id=r.id and status='running';
 update public.analysis_jev_compact_runs set status='running',lease_owner=p_worker,lease_until=now()+interval '240 seconds',started_at=coalesce(started_at,now()) where id=r.id returning * into r;return to_jsonb(r);end $$;
create function public.claim_compact_tasks(p_run uuid,p_worker uuid) returns setof public.analysis_jev_compact_tasks language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jev_compact_runs;t public.analysis_jev_compact_tasks;c public.analysis_jev_economy_configurations;i public.analysis_jev_compact_items;reserve jsonb;identity jsonb;cache public.analysis_jev_review_cache;begin
 select * into r from public.analysis_jev_compact_runs where id=p_run and status='running' and lease_owner=p_worker and lease_until>now() for update;if not found then raise exception 'COMPACT_LEASE_LOST';end if;
 if not exists(select 1 from public.analysis_jev_compact_authorizations a where a.set_id=r.set_id and a.dataset_sha256=r.seal->>'dataset_sha256' and a.reference_sha256=r.seal->>'reference_sha256') then raise exception 'COMPACT_PAID_NOT_AUTHORIZED';end if;
 if (select count(*) from public.analysis_jev_compact_tasks where run_id=p_run)<>64 then raise exception 'COMPACT_TASK_COUNT';end if;
 for t in select * from public.analysis_jev_compact_tasks where run_id=p_run and status='pending' order by review_id,variant for update skip locked limit 8 loop
 select * into c from public.analysis_jev_economy_configurations where id=t.configuration_id;select * into i from public.analysis_jev_compact_items where set_id=r.set_id and review_id=t.review_id;
 identity=jsonb_build_object('organization_id',r.organization_id,'establishment_id',i.establishment_id,'review_id',t.review_id,'analysis_text_sha256',t.analysis_text_sha256,'configuration_id',c.id,'instruction_version',c.config->>'instruction_version','instruction_sha256',c.instruction_sha256,'threshold_version',c.config->>'threshold_version','threshold_sha256',c.threshold_sha256,'requested_model',c.config->>'requested_model','expected_served_model',r.expected_served_model);
 reserve=public.reserve_jev_economy_cache(r.created_by,identity);select * into cache from public.analysis_jev_review_cache where id=(reserve->>'id')::uuid;
 if reserve->>'reusable'='true' then
 update public.analysis_jev_compact_tasks set status='completed',cache_id=cache.id,reused=true,response=cache.response,served_model=cache.served_model,input_tokens=0,output_tokens=0,cost_usd=0,request_count=0,usage_complete=true,completed_at=now() where id=t.id;
 elsif reserve->>'claimed'<>'true' then update public.analysis_jev_compact_tasks set status='failed',cache_id=cache.id,error_code='COMPACT_CACHE_BLOCKED_NO_RETRY',usage_complete=false,completed_at=now() where id=t.id;
 elsif (select coalesce(sum(cost_usd),0) from public.analysis_jev_compact_tasks where run_id=p_run)>=r.cost_limit_usd then update public.analysis_jev_compact_tasks set status='failed',cache_id=cache.id,error_code='COMPACT_COST_LIMIT',completed_at=now() where id=t.id;
 else
 update public.analysis_jev_compact_tasks set status='running',cache_id=cache.id,lease_owner=p_worker,started_at=now() where id=t.id returning * into t;
 update public.analysis_jev_review_cache set status='dispatched',attempt_id=t.id,confirmed_by=r.created_by,confirmed_at=r.cost_confirmed_at where id=cache.id;
 return next t;
 end if;
 end loop;end $$;
create function public.complete_compact_task(p_run uuid,p_worker uuid,p_task uuid,p_values jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jev_compact_runs;t public.analysis_jev_compact_tasks;c public.analysis_jev_review_cache;actual_cost numeric;actual_id uuid;identity jsonb;begin
 select * into r from public.analysis_jev_compact_runs where id=p_run and status='running' and lease_owner=p_worker and lease_until>now() for update;if not found then return false;end if;
 select * into t from public.analysis_jev_compact_tasks where id=p_task and run_id=p_run and status='running' and lease_owner=p_worker for update;if not found then return false;end if;
 if p_values->>'status' not in ('completed','failed') or (p_values->>'request_count')::int<>1 or (p_values->>'retry_count')::int<>0 then raise exception 'COMPACT_NO_RETRY';end if;
 actual_cost=((p_values->>'input_tokens')::numeric*(r.rates->>'input')::numeric+(p_values->>'output_tokens')::numeric*(r.rates->>'output')::numeric)/1000000;
 select * into c from public.analysis_jev_review_cache where id=t.cache_id for update;actual_id=c.id;
 if p_values->>'status'='completed' and p_values->>'served_model'=c.expected_served_model then
 update public.analysis_jev_review_cache set status='completed',response=p_values->'response',theme_results=p_values->'theme_results',served_model=p_values->>'served_model',input_tokens=(p_values->>'input_tokens')::bigint,output_tokens=(p_values->>'output_tokens')::bigint,cost_usd=actual_cost,usage_complete=(p_values->>'usage_complete')::boolean,processed_at=now() where id=c.id;
 else
 update public.analysis_jev_review_cache set status='billing_uncertain',served_model=p_values->>'served_model',input_tokens=(p_values->>'input_tokens')::bigint,output_tokens=(p_values->>'output_tokens')::bigint,cost_usd=actual_cost,usage_complete=(p_values->>'usage_complete')::boolean,error_code=coalesce(p_values->>'error_code','COMPACT_SERVED_MODEL_CHANGED'),processed_at=now() where id=c.id;
 if p_values->>'status'='completed' then
 identity=jsonb_build_object('organization_id',c.organization_id,'establishment_id',c.establishment_id,'review_id',c.review_id,'analysis_text_sha256',c.analysis_text_sha256,'configuration_id',c.configuration_id,'instruction_version',c.instruction_version,'instruction_sha256',c.instruction_sha256,'threshold_version',c.threshold_version,'threshold_sha256',c.threshold_sha256,'requested_model',c.requested_model,'expected_served_model',p_values->>'served_model');
 insert into public.analysis_jev_review_cache(cache_key,organization_id,establishment_id,review_id,analysis_text_sha256,configuration_id,instruction_version,instruction_sha256,threshold_version,threshold_sha256,requested_model,expected_served_model,status,response,theme_results,served_model,input_tokens,output_tokens,cost_usd,usage_complete,processed_at,source_kind,source_run_id,source_task_id)
 values(encode(extensions.digest(public.jev_economy_canonical(identity),'sha256'),'hex'),c.organization_id,c.establishment_id,c.review_id,c.analysis_text_sha256,c.configuration_id,c.instruction_version,c.instruction_sha256,c.threshold_version,c.threshold_sha256,c.requested_model,p_values->>'served_model','completed',p_values->'response',p_values->'theme_results',p_values->>'served_model',(p_values->>'input_tokens')::bigint,(p_values->>'output_tokens')::bigint,actual_cost,(p_values->>'usage_complete')::boolean,now(),'compact_benchmark',p_run,p_task) on conflict(cache_key) do nothing;
 select id into actual_id from public.analysis_jev_review_cache where cache_key=encode(extensions.digest(public.jev_economy_canonical(identity),'sha256'),'hex');
 end if;
 end if;
 update public.analysis_jev_compact_tasks set status=p_values->>'status',cache_id=actual_id,response=p_values->'response',served_model=p_values->>'served_model',input_tokens=(p_values->>'input_tokens')::bigint,output_tokens=(p_values->>'output_tokens')::bigint,cost_usd=actual_cost,duration_ms=(p_values->>'duration_ms')::bigint,request_count=1,usage_complete=(p_values->>'usage_complete')::boolean,error_code=p_values->>'error_code',completed_at=now() where id=t.id;
 insert into public.analysis_jev_review_cache_events(cache_id,organization_id,action,actor_id,details) values(actual_id,r.organization_id,'compact_benchmark_single_attempt',r.created_by,jsonb_build_object('task_id',t.id,'run_id',r.id,'variant',t.variant,'served_model',p_values->>'served_model','request_count',1));
 update public.analysis_jev_compact_runs set lease_until=now()+interval '240 seconds' where id=r.id;return true;end $$;
create function public.finish_compact_tick(p_run uuid,p_worker uuid,p_comparison jsonb default null,p_error text default null) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jev_compact_runs;begin select * into r from public.analysis_jev_compact_runs where id=p_run and status='running' and lease_owner=p_worker and lease_until>now() for update;if not found then return false;end if;
 if p_error is not null then update public.analysis_jev_compact_runs set status='failed',error_code=p_error,completed_at=now(),lease_owner=null,lease_until=null where id=r.id;
 elsif p_comparison is not null then
 if exists(select 1 from public.analysis_jev_compact_tasks where run_id=r.id and status in ('pending','running')) or p_comparison->>'human_validated'<>'false' then raise exception 'COMPACT_RESULT_INVALID';end if;
 insert into public.analysis_jev_compact_results(run_id,organization_id,comparison) values(r.id,r.organization_id,p_comparison);update public.analysis_jev_compact_runs set status='completed',completed_at=now(),lease_owner=null,lease_until=null where id=r.id;
 else update public.analysis_jev_compact_runs set lease_owner=null,lease_until=null where id=r.id;end if;return true;end $$;
revoke all on function public.claim_compact_run(uuid),public.claim_compact_tasks(uuid,uuid),public.complete_compact_task(uuid,uuid,uuid,jsonb),public.finish_compact_tick(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_compact_run(uuid),public.claim_compact_tasks(uuid,uuid),public.complete_compact_task(uuid,uuid,uuid,jsonb),public.finish_compact_tick(uuid,uuid,jsonb,text) to service_role;
select cron.schedule('home-reviews-compact-paired-worker-v1','* * * * *',$cron$
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-jev-compact',headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),body:='{}'::jsonb,timeout_milliseconds:=180000)
 where exists(select 1 from public.analysis_jev_compact_runs r join public.analysis_jev_compact_authorizations a on a.set_id=r.set_id where r.status in ('queued','running') and (r.lease_until is null or r.lease_until<=now()));
$cron$);
