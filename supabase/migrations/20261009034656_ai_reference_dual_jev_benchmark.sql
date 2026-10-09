-- Reuse the three already prepared AI exploratory tables; no real run is inserted.
create table if not exists public.analysis_negative_validation_ai_preannotations (
 experiment_id uuid not null references public.analysis_negative_validation_runs(id),review_id uuid not null,
 analysis_text_sha256 text not null,rubric_version text not null,model_source text not null,theme_choices jsonb not null,
 notes_fr text not null default '',needs_human_review boolean not null default true,created_at timestamptz not null default now(),
 primary key(experiment_id,review_id)
);
create table if not exists public.analysis_negative_ai_exploratory_runs (
 id uuid primary key default gen_random_uuid(),source_experiment_id uuid not null unique references public.analysis_negative_validation_runs(id),
 methodology text not null default 'exploratory_ai_reference_not_human_gold' check(methodology='exploratory_ai_reference_not_human_gold'),
 status text not null default 'prepared' check(status in ('prepared','queued','running','completed','failed')),
 requested_model text not null default 'jev-latest',expected_tasks integer not null default 192 check(expected_tasks=192),
 input_rate_usd_per_million numeric not null default .042,status_note text not null default 'AI reference; not human Gold',
 lease_owner uuid,lease_until timestamptz,started_at timestamptz,completed_at timestamptz,last_tick_at timestamptz,error_code text,created_at timestamptz not null default now()
);
create table if not exists public.analysis_negative_ai_exploratory_tasks (
 id uuid primary key default gen_random_uuid(),run_id uuid not null references public.analysis_negative_ai_exploratory_runs(id),
 experiment_id uuid not null,review_id uuid not null,analysis_text_sha256 text not null,
 model_version text not null check(model_version in ('v9','v11')),review_alias text not null,question_set_version text not null,
 repeat integer not null check(repeat between 1 and 3),status text not null default 'pending' check(status in ('pending','running','completed','failed')),
 response jsonb,served_model text,input_tokens bigint not null default 0,output_tokens bigint not null default 0,
 request_count integer not null default 0,retry_count integer not null default 0,cost_usd double precision not null default 0,
 duration_ms bigint not null default 0,error_code text,usage_complete boolean not null default true,started_at timestamptz,completed_at timestamptz,created_at timestamptz not null default now(),
 unique(run_id,review_id,model_version,repeat),foreign key(experiment_id,review_id) references public.analysis_negative_validation_ai_preannotations(experiment_id,review_id)
);
create table if not exists public.analysis_negative_ai_exploratory_results (
 run_id uuid primary key references public.analysis_negative_ai_exploratory_runs(id),comparison jsonb not null,created_at timestamptz not null default now()
);
alter table public.analysis_negative_ai_exploratory_runs add column if not exists organization_id uuid references public.organizations(id);
alter table public.analysis_negative_ai_exploratory_runs add column if not exists establishment_id uuid references public.establishments(id);
alter table public.analysis_negative_ai_exploratory_runs add column if not exists created_by uuid references auth.users(id);
alter table public.analysis_negative_ai_exploratory_runs add column if not exists launch_approved_at timestamptz;
alter table public.analysis_negative_ai_exploratory_runs add column if not exists model_config jsonb;
alter table public.analysis_negative_ai_exploratory_runs add column if not exists dataset_snapshot jsonb;
alter table public.analysis_negative_ai_exploratory_runs add column if not exists reference_snapshot jsonb;
alter table public.analysis_negative_ai_exploratory_runs add column if not exists dataset_sha256 text;
alter table public.analysis_negative_ai_exploratory_runs add column if not exists reference_sha256 text;
alter table public.analysis_negative_ai_exploratory_tasks add column if not exists lease_owner uuid;
alter table public.analysis_jev_exploratory_items add column if not exists ai_reference jsonb not null default '{}';
create index if not exists negative_ai_tasks_pending on public.analysis_negative_ai_exploratory_tasks(run_id,status);
-- Existing preannotations remain private, not exposed as human labels.
alter table public.analysis_negative_validation_ai_preannotations enable row level security;
revoke all on public.analysis_negative_validation_ai_preannotations from anon,authenticated;
grant select on public.analysis_negative_validation_ai_preannotations to service_role;
do $$ declare t text;begin
 foreach t in array array['analysis_negative_ai_exploratory_runs','analysis_negative_ai_exploratory_tasks','analysis_negative_ai_exploratory_results'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);execute format('grant all on public.%I to service_role',t);
 if t='analysis_negative_ai_exploratory_runs' then
 execute format('create policy negative_ai_owner_read on public.%I for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=%I.organization_id and m.user_id=(select auth.uid()) and m.role in (''owner'',''admin'',''manager'')))',t,t);
 else
 execute format('create policy negative_ai_owner_read on public.%I for select to authenticated using(exists(select 1 from public.analysis_negative_ai_exploratory_runs r join public.organization_members m on m.organization_id=r.organization_id where r.id=%I.run_id and m.user_id=(select auth.uid()) and m.role in (''owner'',''admin'',''manager'')))',t,t);end if;
 end loop;end $$;
create function public.negative_ai_benchmark_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'AI_BENCHMARK_IMMUTABLE';end if;
 if tg_table_name='analysis_negative_ai_exploratory_runs' then
 if old.status in ('completed','failed') or (to_jsonb(new)-array['status','lease_owner','lease_until','started_at','completed_at','last_tick_at','error_code']) is distinct from (to_jsonb(old)-array['status','lease_owner','lease_until','started_at','completed_at','last_tick_at','error_code']) then raise exception 'AI_BENCHMARK_IMMUTABLE';end if;
 elsif tg_table_name='analysis_negative_ai_exploratory_tasks' then
 if old.status in ('completed','failed') or (to_jsonb(new)-array['status','lease_owner','response','served_model','input_tokens','output_tokens','request_count','retry_count','cost_usd','duration_ms','error_code','usage_complete','started_at','completed_at']) is distinct from (to_jsonb(old)-array['status','lease_owner','response','served_model','input_tokens','output_tokens','request_count','retry_count','cost_usd','duration_ms','error_code','usage_complete','started_at','completed_at']) then raise exception 'AI_BENCHMARK_IMMUTABLE';end if;
 else raise exception 'AI_BENCHMARK_IMMUTABLE';end if;return new;
end $$;
create trigger negative_ai_run_guard before update or delete on public.analysis_negative_ai_exploratory_runs for each row execute function public.negative_ai_benchmark_guard();
create trigger negative_ai_task_guard before update or delete on public.analysis_negative_ai_exploratory_tasks for each row execute function public.negative_ai_benchmark_guard();
create trigger negative_ai_result_guard before update or delete on public.analysis_negative_ai_exploratory_results for each row execute function public.negative_ai_benchmark_guard();
create function public.start_negative_ai_benchmark(p_user uuid,p_source uuid,p_confirm boolean,p_items jsonb,p_reference jsonb,p_dataset_hash text,p_reference_hash text,p_config jsonb,p_rate numeric) returns uuid language plpgsql security invoker set search_path='' as $$
declare s public.analysis_negative_validation_runs;r public.analysis_negative_ai_exploratory_runs;i jsonb;a jsonb;ref public.analysis_negative_validation_ai_preannotations;src public.analysis_negative_validation_reviews;rid uuid;
begin
 select * into s from public.analysis_negative_validation_runs where id=p_source;
 if s.id is null or not exists(select 1 from public.organization_members where organization_id=s.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if p_confirm is distinct from true then raise exception 'AI_BENCHMARK_PAYMENT_CONFIRMATION_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('negative-ai-benchmark:'||p_source::text,0));
 select * into r from public.analysis_negative_ai_exploratory_runs where source_experiment_id=p_source;
 if found then return r.id;end if;
 if jsonb_array_length(p_items)<>32 or (select count(distinct x->>'review_id') from jsonb_array_elements(p_items) x)<>32 or jsonb_array_length(p_reference)<>32 or (select count(distinct x->>'review_id') from jsonb_array_elements(p_reference) x)<>32 then raise exception 'AI_BENCHMARK_DATASET_INVALID';end if;
 if p_config->'v9'->>'question_set' is distinct from 'themes_phase2_v7' or p_config->'v9'->>'threshold' is distinct from '0.5' or p_config->'v11'->>'question_set' is distinct from 'themes_v11_human_aligned_v1' or p_config->'v11'->>'threshold_version' is distinct from 'jev-theme-thresholds-v2' or p_config->>'concurrency' is distinct from '8' or p_config->'v9'->>'repeat_count' is distinct from '3' or p_config->'v11'->>'repeat_count' is distinct from '3' then raise exception 'AI_BENCHMARK_CONFIG_CHANGED';end if;
 for i in select * from jsonb_array_elements(p_items) loop
  select * into src from public.analysis_negative_validation_reviews where experiment_id=p_source and review_id=(i->>'review_id')::uuid and not excluded;
  select * into ref from public.analysis_negative_validation_ai_preannotations where experiment_id=p_source and review_id=(i->>'review_id')::uuid;
  select value into a from jsonb_array_elements(p_reference) where value->>'review_id'=i->>'review_id';
  if src.review_id is null or ref.review_id is null or a is null or src.analysis_language is distinct from 'en' or src.analysis_source not in ('original_en','google_translation_en') or src.analysis_text is distinct from i->>'analysis_text' or src.analysis_text_sha256 is distinct from i->>'analysis_text_sha256' or src.analysis_text_sha256 is distinct from ref.analysis_text_sha256 or encode(extensions.digest(src.analysis_text,'sha256'),'hex') is distinct from src.analysis_text_sha256 or ref.theme_choices is distinct from a->'theme_choices' or ref.model_source is distinct from a->>'model_source' or ref.rubric_version is distinct from a->>'rubric_version' or ref.created_at is distinct from (a->>'created_at')::timestamptz or ref.analysis_text_sha256 is distinct from a->>'analysis_text_sha256' or ref.theme_choices is distinct from i->'ai_reference' then raise exception 'AI_BENCHMARK_REFERENCE_INVALID';end if;
  if src.overall_rating::text is distinct from i->>'overall_rating' or src.normalized_category_ratings is distinct from i->'normalized_category_ratings' then raise exception 'AI_BENCHMARK_DATASET_INVALID';end if;
  if to_regclass('public.analysis_v11_independent_holdout_items') is not null then
   execute 'select exists(select 1 from public.analysis_v11_independent_holdout_items where review_id=$1)' into p_confirm using src.review_id;
   if p_confirm then raise exception 'AI_BENCHMARK_PROTECTED_HOLDOUT';end if;
  end if;
 end loop;
 insert into public.analysis_negative_ai_exploratory_runs(source_experiment_id,organization_id,establishment_id,status,created_by,launch_approved_at,model_config,dataset_snapshot,reference_snapshot,dataset_sha256,reference_sha256,input_rate_usd_per_million)
 values(p_source,s.organization_id,s.establishment_id,'queued',p_user,now(),p_config,p_items,p_reference,p_dataset_hash,p_reference_hash,p_rate) returning id into rid;
 insert into public.analysis_negative_ai_exploratory_tasks(run_id,experiment_id,review_id,analysis_text_sha256,model_version,review_alias,question_set_version,repeat)
 select rid,p_source,(x->>'review_id')::uuid,x->>'analysis_text_sha256',v,'r'||(x->>'position'),case when v='v9' then 'themes_phase2_v7' else 'themes_v11_human_aligned_v1' end,n from jsonb_array_elements(p_items) x cross join (values('v9'),('v11')) versions(v) cross join generate_series(1,3) n;return rid;
end $$;
create or replace function public.claim_negative_ai_exploratory_run(p_worker uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.analysis_negative_ai_exploratory_runs;
begin
 perform pg_advisory_xact_lock(hashtextextended('negative-ai-worker',0));
 if exists(select 1 from public.analysis_negative_ai_exploratory_runs where status='running' and lease_until>now()) then return null;end if;
 select * into r from public.analysis_negative_ai_exploratory_runs where status='queued' or(status='running' and (lease_until is null or lease_until<=now())) order by created_at for update skip locked limit 1;if not found then return null;end if;
 update public.analysis_negative_ai_exploratory_tasks set status='failed',error_code='JEV_RESPONSE_UNCONFIRMED',usage_complete=false,completed_at=now() where run_id=r.id and status='running';
 update public.analysis_negative_ai_exploratory_runs set status='running',lease_owner=p_worker,lease_until=now()+interval '240 seconds',started_at=coalesce(started_at,now()),last_tick_at=now() where id=r.id returning * into r;return to_jsonb(r);
end $$;
create function public.claim_negative_ai_tasks(p_id uuid,p_worker uuid) returns setof public.analysis_negative_ai_exploratory_tasks language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.analysis_negative_ai_exploratory_runs where id=p_id and status='running' and lease_owner=p_worker and lease_until>now()) then raise exception 'AI_BENCHMARK_LEASE_LOST';end if;
 return query update public.analysis_negative_ai_exploratory_tasks set status='running',lease_owner=p_worker,started_at=now() where id in(select id from public.analysis_negative_ai_exploratory_tasks where run_id=p_id and status='pending' order by review_id,model_version,repeat for update skip locked limit 8) returning *;
end $$;
create function public.complete_negative_ai_task(p_id uuid,p_worker uuid,p_task uuid,p_values jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.analysis_negative_ai_exploratory_runs;
begin
 select * into r from public.analysis_negative_ai_exploratory_runs where id=p_id and status='running' and lease_owner=p_worker and lease_until>now() for update;if not found then return false;end if;
 update public.analysis_negative_ai_exploratory_tasks set status=p_values->>'status',response=p_values->'response',served_model=p_values->>'served_model',input_tokens=(p_values->>'input_tokens')::bigint,output_tokens=(p_values->>'output_tokens')::bigint,request_count=(p_values->>'request_count')::integer,retry_count=(p_values->>'retry_count')::integer,cost_usd=(p_values->>'input_tokens')::double precision/1000000*r.input_rate_usd_per_million,duration_ms=(p_values->>'duration_ms')::bigint,error_code=p_values->>'error_code',usage_complete=(p_values->>'usage_complete')::boolean,completed_at=now() where id=p_task and run_id=p_id and status='running' and lease_owner=p_worker;if not found then return false;end if;
 update public.analysis_negative_ai_exploratory_runs set lease_until=now()+interval '240 seconds' where id=p_id;return true;
end $$;
create function public.finish_negative_ai_benchmark(p_id uuid,p_worker uuid,p_comparison jsonb default null,p_error text default null) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.analysis_negative_ai_exploratory_runs;
begin
 select * into r from public.analysis_negative_ai_exploratory_runs where id=p_id and status='running' and lease_owner=p_worker and lease_until>now() for update;if not found then return false;end if;
 if p_error is not null then update public.analysis_negative_ai_exploratory_runs set status='failed',error_code=p_error,completed_at=now(),lease_owner=null,lease_until=null where id=p_id;
 elsif p_comparison is not null then
 if exists(select 1 from public.analysis_negative_ai_exploratory_tasks where run_id=p_id and status in ('pending','running')) or (select count(*) from public.analysis_negative_ai_exploratory_tasks where run_id=p_id)<>192 or p_comparison->>'reference_type' is distinct from 'chatgpt_ai_preannotations' or p_comparison->>'human_validated' is distinct from 'false' then raise exception 'AI_BENCHMARK_RESULT_INVALID';end if;
 insert into public.analysis_negative_ai_exploratory_results(run_id,comparison) values(p_id,p_comparison);
 update public.analysis_negative_ai_exploratory_runs set status='completed',completed_at=now(),lease_owner=null,lease_until=null where id=p_id;
 else update public.analysis_negative_ai_exploratory_runs set lease_owner=null,lease_until=null,last_tick_at=now() where id=p_id;end if;return true;
end $$;
-- Old finishing RPC cannot bypass the immutable result publication contract.
create or replace function public.finish_negative_ai_exploratory_tick(p_run_id uuid,p_worker uuid,p_status text,p_error text default null) returns boolean language plpgsql security invoker set search_path='' as $$
begin if p_status='completed' then raise exception 'AI_BENCHMARK_RESULT_REQUIRED';end if;return public.finish_negative_ai_benchmark(p_run_id,p_worker,null,p_error);end $$;
revoke all on function public.negative_ai_benchmark_guard(),public.start_negative_ai_benchmark(uuid,uuid,boolean,jsonb,jsonb,text,text,jsonb,numeric),public.claim_negative_ai_exploratory_run(uuid),public.claim_negative_ai_tasks(uuid,uuid),public.complete_negative_ai_task(uuid,uuid,uuid,jsonb),public.finish_negative_ai_benchmark(uuid,uuid,jsonb,text),public.finish_negative_ai_exploratory_tick(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.start_negative_ai_benchmark(uuid,uuid,boolean,jsonb,jsonb,text,text,jsonb,numeric),public.claim_negative_ai_exploratory_run(uuid),public.claim_negative_ai_tasks(uuid,uuid),public.complete_negative_ai_task(uuid,uuid,uuid,jsonb),public.finish_negative_ai_benchmark(uuid,uuid,jsonb,text),public.finish_negative_ai_exploratory_tick(uuid,uuid,text,text) to service_role;
select cron.schedule('home-reviews-negative-ai-benchmark-v1','* * * * *',$cron$
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-ai-exploratory-benchmarks',headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),body:='{}'::jsonb,timeout_milliseconds:=180000)
 where exists(select 1 from public.analysis_negative_ai_exploratory_runs where status in ('queued','running') and (lease_until is null or lease_until<=now()));
$cron$);

-- The existing suspect-review/correction route reuses completed benchmark responses, never calls Jev again.
create or replace function public.create_jev_exploration(p_user uuid,p_org uuid,p_establishment uuid,p_kind text,p_source uuid,p_items jsonb,p_fingerprint text,p_config jsonb,p_rate double precision) returns uuid language plpgsql security invoker set search_path='' as $$
declare rid uuid;item jsonb;src jsonb;total integer;benchmark_source jsonb;
begin
 if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('jev-exploratory:'||p_kind||p_source::text,0));
 select id into rid from public.analysis_jev_exploratory_runs where organization_id=p_org and source_kind=p_kind and source_id=p_source;if found then return rid;end if;
 if p_kind='negative_validation' then
  if not exists(select 1 from public.analysis_negative_validation_runs where id=p_source and organization_id=p_org and establishment_id=p_establishment) then raise exception 'FORBIDDEN';end if;
  select dataset_snapshot into benchmark_source from public.analysis_negative_ai_exploratory_runs where source_experiment_id=p_source and status='completed' and organization_id=p_org;
  if benchmark_source is null then select count(*) into total from public.analysis_negative_validation_reviews where experiment_id=p_source and not excluded;else total=jsonb_array_length(benchmark_source);end if;
 elsif p_kind='historical_v11' then
  if not exists(select 1 from public.historical_report_runs where id=p_source and organization_id=p_org and establishment_id=p_establishment and status='completed' and snapshot->>'analysis_version'='11') then raise exception 'FORBIDDEN';end if;
  select count(*) into total from public.historical_report_runs h cross join jsonb_array_elements(h.snapshot->'reviews') x where h.id=p_source and btrim(coalesce(x->>'analysis_text',''))<>'';
 else raise exception 'EXPLORATORY_SOURCE_INVALID';end if;
 if total=0 or jsonb_array_length(p_items)<>total or (select count(distinct x->>'review_id') from jsonb_array_elements(p_items) x)<>total then raise exception 'EXPLORATORY_DATASET_INVALID';end if;
 if p_config->>'question_set' is distinct from 'themes_v11_human_aligned_v1' or p_config->>'threshold_version' is distinct from 'jev-theme-thresholds-v2' or p_config->>'repeat_count' is distinct from '3' or p_config->>'concurrency' is distinct from '8' then raise exception 'EXPLORATORY_CONFIG_CHANGED';end if;
 insert into public.analysis_jev_exploratory_runs(organization_id,establishment_id,source_kind,source_id,dataset_sha256,config,rate,created_by)
 values(p_org,p_establishment,p_kind,p_source,p_fingerprint,p_config,p_rate,p_user) returning id into rid;
 for item in select * from jsonb_array_elements(p_items) loop
  src=null;
  if p_kind='negative_validation' then
   if benchmark_source is not null then select x into src from jsonb_array_elements(benchmark_source) x where x->>'review_id'=item->>'review_id';
   else select to_jsonb(i) into src from public.analysis_negative_validation_reviews i where experiment_id=p_source and review_id=(item->>'review_id')::uuid and not excluded;end if;
  else select x into src from public.historical_report_runs h cross join jsonb_array_elements(h.snapshot->'reviews') x where h.id=p_source and x->>'id'=item->>'review_id';end if;
  if src is null or src->>'analysis_language' is distinct from 'en' or btrim(coalesce(src->>'analysis_text',''))='' or src->>'analysis_text' is distinct from item->>'analysis_text' or encode(extensions.digest(item->>'analysis_text','sha256'),'hex') is distinct from item->>'analysis_text_sha256' then raise exception 'EXPLORATORY_ENGLISH_REQUIRED';end if;
  if p_kind='negative_validation' then
   if src->>'analysis_source' not in ('original_en','google_translation_en') or src->>'overall_rating' is distinct from item->>'overall_rating' or src->'normalized_category_ratings' is distinct from item->'normalized_category_ratings' then raise exception 'EXPLORATORY_SOURCE_CHANGED';end if;
  else
   if src->>'rating' is distinct from item->>'overall_rating' or src->'normalized_category_ratings' is distinct from item->'normalized_category_ratings' then raise exception 'EXPLORATORY_SOURCE_CHANGED';end if;
  end if;
  if coalesce(item->'ai_reference','{}'::jsonb) is distinct from coalesce(src->'ai_reference','{}'::jsonb) then raise exception 'EXPLORATORY_REFERENCE_CHANGED';end if;
  insert into public.analysis_jev_exploratory_items(run_id,review_id,position,analysis_text,analysis_text_sha256,overall_rating,normalized_category_ratings,v9,v11,ai_reference) values(rid,(item->>'review_id')::uuid,(item->>'position')::integer,item->>'analysis_text',item->>'analysis_text_sha256',(item->>'overall_rating')::integer,item->'normalized_category_ratings',item->'v9',item->'v11',coalesce(item->'ai_reference','{}'::jsonb));
 end loop;
 if benchmark_source is not null or not exists(select 1 from public.analysis_jev_exploratory_items where run_id=rid and (select count(*) from jsonb_object_keys(v11))<>25) then update public.analysis_jev_exploratory_runs set status='completed',completed_at=now() where id=rid;end if;
 insert into public.analysis_jev_exploratory_events(run_id,actor_user_id,action) values(rid,p_user,'created');return rid;
end $$;
