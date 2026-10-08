-- Dedicated human-first experiment. No historical/benchmark/Gold writes, no enqueue at deployment.
create table public.analysis_negative_validation_runs(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),establishment_id uuid not null references public.establishments(id),
 name text not null check(name='artisan-negative-validation-v1'),methodology text not null check(methodology='independent_negative_mixed_validation'),rubric_version text not null check(rubric_version='human-aligned-review-rubric-v1'),rubric jsonb not null,
 status text not null default 'draft' check(status in ('draft','completed')),revision integer not null default 0,selection_pool jsonb not null,reference_at timestamptz not null default now(),
 dataset_fingerprint text,label_fingerprint text,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),human_completed_at timestamptz,
 benchmark_status text not null default 'idle' check(benchmark_status in ('idle','queued','running','completed','failed')),benchmark_started_at timestamptz,benchmark_completed_at timestamptz,benchmark_error text,
 model_config jsonb not null,rates jsonb not null default '{"jev_input":0.042}',locked_by uuid,lease_until timestamptz,
 unique(organization_id,establishment_id,name),check((status='completed')=(human_completed_at is not null)),check(status='draft' or (dataset_fingerprint~'^[a-f0-9]{64}$' and label_fingerprint~'^[a-f0-9]{64}$')),
 check(benchmark_status='idle' or status='completed')
);
create table public.analysis_negative_validation_reviews(
 experiment_id uuid not null references public.analysis_negative_validation_runs(id),review_id uuid not null,position integer not null check(position between 1 and 32),overall_rating integer not null check(overall_rating between 1 and 5),original_language text,original_text_sha256 text not null check(original_text_sha256~'^[a-f0-9]{64}$'),
 analysis_text text,analysis_language text check(analysis_language='en'),analysis_text_sha256 text,analysis_source text not null check(analysis_source in ('original_en','google_translation_en','english_pending')),
 normalized_category_ratings jsonb not null,selection_bucket text not null check(selection_bucket in ('low','mixed','control')),selection_hash text not null check(selection_hash~'^[a-f0-9]{64}$'),published_at timestamptz,
 excluded boolean not null default false,exclusion_reason text,confirmed_at timestamptz,confirmed_by uuid references auth.users(id),preparation_error text,created_at timestamptz not null default now(),
 primary key(experiment_id,review_id),check((analysis_source='english_pending')=(analysis_text is null)),check(analysis_text is null or (btrim(analysis_text)<>'' and analysis_language='en' and analysis_text_sha256~'^[a-f0-9]{64}$'))
);
create unique index negative_active_position on public.analysis_negative_validation_reviews(experiment_id,position) where not excluded;
create table public.analysis_negative_validation_labels(
 experiment_id uuid not null,review_id uuid not null,theme_key text not null,choice text not null check(choice in ('absent','positive','negative','both','uncertain')),annotator_user_id uuid not null references auth.users(id),updated_at timestamptz not null default now(),
 primary key(experiment_id,review_id,theme_key),foreign key(experiment_id,review_id) references public.analysis_negative_validation_reviews(experiment_id,review_id)
);
create table public.analysis_negative_validation_tasks(
 id uuid primary key default gen_random_uuid(),experiment_id uuid not null references public.analysis_negative_validation_runs(id),model_version text not null check(model_version in ('v9','v11')),review_id uuid not null,review_alias text not null,question_set_version text not null,repeat integer not null check(repeat between 1 and 3),
 status text not null default 'pending' check(status in ('pending','running','completed','failed')),response jsonb,served_model text,input_tokens bigint not null default 0,output_tokens bigint not null default 0,request_count integer not null default 0,retry_count integer not null default 0,cost_usd double precision not null default 0,duration_ms bigint not null default 0,error_code text,usage_complete boolean not null default true,
 locked_by uuid,started_at timestamptz,completed_at timestamptz,unique(experiment_id,model_version,review_id,repeat),foreign key(experiment_id,review_id) references public.analysis_negative_validation_reviews(experiment_id,review_id)
);
create table public.analysis_negative_validation_results(experiment_id uuid primary key references public.analysis_negative_validation_runs(id),comparison jsonb not null,created_at timestamptz not null default now());
create table public.analysis_negative_validation_events(id bigint generated always as identity primary key,experiment_id uuid not null references public.analysis_negative_validation_runs(id),actor_user_id uuid references auth.users(id),action text not null,payload jsonb not null default '{}',created_at timestamptz not null default now());
create index negative_run_org on public.analysis_negative_validation_runs(organization_id,created_at desc);
create index negative_run_queue on public.analysis_negative_validation_runs(benchmark_status,lease_until);
create index negative_task_queue on public.analysis_negative_validation_tasks(experiment_id,status,review_id,repeat,model_version);
create index negative_events_parent on public.analysis_negative_validation_events(experiment_id,id);
alter table public.analysis_negative_validation_runs enable row level security;
alter table public.analysis_negative_validation_reviews enable row level security;
alter table public.analysis_negative_validation_labels enable row level security;
alter table public.analysis_negative_validation_tasks enable row level security;
alter table public.analysis_negative_validation_results enable row level security;
alter table public.analysis_negative_validation_events enable row level security;
-- Blind views are projected by Edge; authenticated clients never read raw ratings/tasks.
revoke all on public.analysis_negative_validation_runs,public.analysis_negative_validation_reviews,public.analysis_negative_validation_labels,public.analysis_negative_validation_tasks,public.analysis_negative_validation_results,public.analysis_negative_validation_events from public,anon,authenticated;
grant all on public.analysis_negative_validation_runs,public.analysis_negative_validation_reviews,public.analysis_negative_validation_labels,public.analysis_negative_validation_tasks,public.analysis_negative_validation_results,public.analysis_negative_validation_events to service_role;
revoke all on sequence public.analysis_negative_validation_events_id_seq from public,anon,authenticated;
grant usage,select on sequence public.analysis_negative_validation_events_id_seq to service_role;
create policy negative_org_read on public.analysis_negative_validation_runs for select to authenticated using((select private.has_org_role(organization_id,array['owner','admin','manager'])));
create policy negative_reviews_org on public.analysis_negative_validation_reviews for select to authenticated using(exists(select 1 from public.analysis_negative_validation_runs r where r.id=experiment_id and private.has_org_role(r.organization_id,array['owner','admin','manager'])));
create policy negative_labels_org on public.analysis_negative_validation_labels for select to authenticated using(exists(select 1 from public.analysis_negative_validation_runs r where r.id=experiment_id and private.has_org_role(r.organization_id,array['owner','admin','manager'])));
create policy negative_tasks_org on public.analysis_negative_validation_tasks for select to authenticated using(exists(select 1 from public.analysis_negative_validation_runs r where r.id=experiment_id and private.has_org_role(r.organization_id,array['owner','admin','manager'])));
create policy negative_results_org on public.analysis_negative_validation_results for select to authenticated using(exists(select 1 from public.analysis_negative_validation_runs r where r.id=experiment_id and private.has_org_role(r.organization_id,array['owner','admin','manager'])));
create policy negative_events_org on public.analysis_negative_validation_events for select to authenticated using(exists(select 1 from public.analysis_negative_validation_runs r where r.id=experiment_id and private.has_org_role(r.organization_id,array['owner','admin','manager'])));

create function public.negative_validation_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare r public.analysis_negative_validation_runs;
begin
 if tg_table_name='analysis_negative_validation_runs' then
  if tg_op='DELETE' then raise exception 'NEGATIVE_AUDIT_IMMUTABLE';end if;
  if (to_jsonb(old)-array['status','revision','dataset_fingerprint','label_fingerprint','human_completed_at','benchmark_status','benchmark_started_at','benchmark_completed_at','benchmark_error','locked_by','lease_until']) is distinct from (to_jsonb(new)-array['status','revision','dataset_fingerprint','label_fingerprint','human_completed_at','benchmark_status','benchmark_started_at','benchmark_completed_at','benchmark_error','locked_by','lease_until']) then raise exception 'NEGATIVE_METADATA_IMMUTABLE';end if;
  if old.status='completed' and (new.status is distinct from old.status or new.dataset_fingerprint is distinct from old.dataset_fingerprint or new.label_fingerprint is distinct from old.label_fingerprint or new.human_completed_at is distinct from old.human_completed_at) then raise exception 'NEGATIVE_HUMAN_IMMUTABLE';end if;
  if old.benchmark_status in ('completed','failed') then raise exception 'NEGATIVE_BENCHMARK_IMMUTABLE';end if;
 else
  select * into r from public.analysis_negative_validation_runs where id=case when tg_op='DELETE' then old.experiment_id else new.experiment_id end for update;
  if tg_op='DELETE' then raise exception 'NEGATIVE_AUDIT_IMMUTABLE';end if;
  if tg_op='UPDATE' and new.experiment_id<>old.experiment_id then raise exception 'NEGATIVE_METADATA_IMMUTABLE';end if;
  if tg_table_name='analysis_negative_validation_events' then if tg_op<>'INSERT' then raise exception 'NEGATIVE_AUDIT_IMMUTABLE';end if;
  elsif tg_table_name in ('analysis_negative_validation_reviews','analysis_negative_validation_labels') then
   if r.status='completed' then raise exception 'NEGATIVE_HUMAN_IMMUTABLE';end if;
   if tg_table_name='analysis_negative_validation_reviews' and tg_op='UPDATE' then
    if (to_jsonb(old)-array['analysis_text','analysis_language','analysis_source','analysis_text_sha256','excluded','exclusion_reason','confirmed_at','confirmed_by','preparation_error']) is distinct from (to_jsonb(new)-array['analysis_text','analysis_language','analysis_source','analysis_text_sha256','excluded','exclusion_reason','confirmed_at','confirmed_by','preparation_error']) then raise exception 'NEGATIVE_METADATA_IMMUTABLE';end if;
    if old.analysis_text is not null and (new.analysis_text is distinct from old.analysis_text or new.analysis_text_sha256 is distinct from old.analysis_text_sha256 or new.analysis_language is distinct from old.analysis_language or new.analysis_source is distinct from old.analysis_source) then raise exception 'NEGATIVE_TEXT_IMMUTABLE';end if;
    if old.excluded and not new.excluded then raise exception 'NEGATIVE_EXCLUSION_IMMUTABLE';end if;
   end if;
   if tg_table_name='analysis_negative_validation_labels' then
    if not exists(select 1 from public.analysis_negative_validation_reviews i where i.experiment_id=new.experiment_id and i.review_id=new.review_id and not i.excluded and i.analysis_language='en' and i.analysis_text is not null) or not (r.rubric ? new.theme_key) then raise exception 'NEGATIVE_LABEL_INVALID';end if;
    if tg_op='UPDATE' and (old.review_id<>new.review_id or old.theme_key<>new.theme_key) then raise exception 'NEGATIVE_METADATA_IMMUTABLE';end if;
   end if;
  elsif tg_table_name='analysis_negative_validation_tasks' then
   if r.status<>'completed' or r.benchmark_status not in ('queued','running') then raise exception 'NEGATIVE_HUMAN_REQUIRED';end if;
   if tg_op='UPDATE' then
    if old.status in ('completed','failed') then raise exception 'NEGATIVE_TASK_IMMUTABLE';end if;
    if (to_jsonb(old)-array['status','response','served_model','input_tokens','output_tokens','request_count','retry_count','cost_usd','duration_ms','error_code','usage_complete','locked_by','started_at','completed_at']) is distinct from (to_jsonb(new)-array['status','response','served_model','input_tokens','output_tokens','request_count','retry_count','cost_usd','duration_ms','error_code','usage_complete','locked_by','started_at','completed_at']) then raise exception 'NEGATIVE_METADATA_IMMUTABLE';end if;
   end if;
  elsif tg_table_name='analysis_negative_validation_results' then if tg_op<>'INSERT' or r.status<>'completed' or r.benchmark_status<>'running' then raise exception 'NEGATIVE_RESULTS_IMMUTABLE';end if;
  end if;
 end if;
 return new;
end $$;

create function public.claim_negative_validation_jobs(p_worker uuid) returns setof public.analysis_negative_validation_runs language plpgsql security invoker set search_path='' as $$
declare r public.analysis_negative_validation_runs;
begin
 perform pg_advisory_xact_lock(hashtextextended('negative-validation-worker-capacity',0));
 if exists(select 1 from public.analysis_negative_validation_runs where benchmark_status='running' and lease_until>now()) then return;end if;
 select * into r from public.analysis_negative_validation_runs where status='completed' and benchmark_status in ('queued','running') and (lease_until is null or lease_until<=now()) order by created_at,id limit 1 for update skip locked;if not found then return;end if;
 update public.analysis_negative_validation_runs set benchmark_status='running',benchmark_started_at=coalesce(benchmark_started_at,now()),locked_by=p_worker,lease_until=now()+interval '240 seconds' where id=r.id returning * into r;return next r;
end $$;
create function public.claim_negative_validation_tasks(p_id uuid,p_worker uuid) returns setof public.analysis_negative_validation_tasks language plpgsql security invoker set search_path='' as $$
declare r public.analysis_negative_validation_runs;t public.analysis_negative_validation_tasks;
begin
 select * into r from public.analysis_negative_validation_runs where id=p_id and locked_by=p_worker and benchmark_status='running' and lease_until>now() for update;if not found then raise exception 'NEGATIVE_LEASE_LOST';end if;
 -- Lost paid responses are never replayed. Missing evaluations stay explicitly unavailable.
 update public.analysis_negative_validation_tasks set status='failed',error_code='JEV_INTERRUPTED_UNCONFIRMED',usage_complete=false,completed_at=now() where experiment_id=p_id and status='running' and locked_by is distinct from p_worker;
 for t in select t2.* from public.analysis_negative_validation_tasks t2 join public.analysis_negative_validation_reviews i on i.experiment_id=t2.experiment_id and i.review_id=t2.review_id where t2.experiment_id=p_id and t2.status='pending' order by i.position,t2.repeat,t2.model_version limit 8 for update of t2 loop
  update public.analysis_negative_validation_tasks set status='running',locked_by=p_worker,started_at=now() where id=t.id returning * into t;return next t;
 end loop;
 update public.analysis_negative_validation_runs set lease_until=now()+interval '240 seconds' where id=p_id;
end $$;
create function public.complete_negative_validation_task(p_id uuid,p_worker uuid,p_task uuid,p_values jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.analysis_negative_validation_runs;t public.analysis_negative_validation_tasks;
begin
 select * into r from public.analysis_negative_validation_runs where id=p_id and locked_by=p_worker and benchmark_status='running' and lease_until>now() for update;if not found then return false;end if;
 select * into t from public.analysis_negative_validation_tasks where id=p_task and experiment_id=p_id and locked_by=p_worker and status='running' for update;if not found then return false;end if;
 if p_values->>'status' not in ('completed','failed') then raise exception 'NEGATIVE_TASK_INVALID';end if;
 update public.analysis_negative_validation_tasks set status=p_values->>'status',response=p_values->'response',served_model=p_values->>'served_model',input_tokens=(p_values->>'input_tokens')::bigint,output_tokens=(p_values->>'output_tokens')::bigint,request_count=(p_values->>'request_count')::integer,retry_count=(p_values->>'retry_count')::integer,cost_usd=(p_values->>'input_tokens')::double precision/1000000*(r.rates->>'jev_input')::double precision,duration_ms=(p_values->>'duration_ms')::bigint,error_code=p_values->>'error_code',usage_complete=(p_values->>'usage_complete')::boolean,completed_at=now() where id=t.id;
 update public.analysis_negative_validation_runs set lease_until=now()+interval '240 seconds' where id=p_id;return true;
end $$;
create function public.finish_negative_validation_tick(p_id uuid,p_worker uuid,p_comparison jsonb default null,p_error text default null) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.analysis_negative_validation_runs;
begin
 select * into r from public.analysis_negative_validation_runs where id=p_id and locked_by=p_worker and benchmark_status='running' and lease_until>now() for update;if not found then return false;end if;
 if p_error is not null then
  if p_error in ('NEGATIVE_CONFIG_CHANGED','NEGATIVE_INTEGRITY_CHANGED','NEGATIVE_TEXT_CHANGED','NEGATIVE_DATASET_INVALID','NEGATIVE_ENGLISH_REQUIRED') or (r.benchmark_started_at is not null and r.benchmark_started_at<now()-interval '24 hours') then
   update public.analysis_negative_validation_runs set benchmark_status='failed',benchmark_completed_at=now(),benchmark_error=p_error,locked_by=null,lease_until=null where id=p_id;return true;
  end if;
  -- Infrastructure failures release the lease; the next tick resumes only pending tasks.
  update public.analysis_negative_validation_runs set benchmark_error=p_error,locked_by=null,lease_until=null where id=p_id;return true;
 elsif p_comparison is not null then
  if exists(select 1 from public.analysis_negative_validation_tasks where experiment_id=p_id and status in ('pending','running')) or (select count(*) from public.analysis_negative_validation_tasks where experiment_id=p_id)<>192 then raise exception 'NEGATIVE_TASKS_PENDING';end if;
  insert into public.analysis_negative_validation_results(experiment_id,comparison) values(p_id,p_comparison);
  insert into public.analysis_negative_validation_events(experiment_id,action) values(p_id,'benchmark_completed');
  update public.analysis_negative_validation_runs set benchmark_status='completed',benchmark_completed_at=now(),benchmark_error=null,locked_by=null,lease_until=null where id=p_id;return true;
 end if;
 update public.analysis_negative_validation_runs set locked_by=null,lease_until=null,benchmark_error=null where id=p_id;return true;
end $$;
create trigger negative_run_guard before update or delete on public.analysis_negative_validation_runs for each row execute function public.negative_validation_guard();
create trigger negative_reviews_guard before insert or update or delete on public.analysis_negative_validation_reviews for each row execute function public.negative_validation_guard();
create trigger negative_labels_guard before insert or update or delete on public.analysis_negative_validation_labels for each row execute function public.negative_validation_guard();
create trigger negative_tasks_guard before insert or update or delete on public.analysis_negative_validation_tasks for each row execute function public.negative_validation_guard();
create trigger negative_results_guard before insert or update or delete on public.analysis_negative_validation_results for each row execute function public.negative_validation_guard();
create trigger negative_events_guard before insert or update or delete on public.analysis_negative_validation_events for each row execute function public.negative_validation_guard();
revoke all on function public.negative_validation_guard() from public,anon,authenticated;

create function public.insert_negative_review(p_id uuid,p_item jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare run public.analysis_negative_validation_runs;source public.reviews;candidate jsonb;english text;source_kind text;
begin
 select * into run from public.analysis_negative_validation_runs where id=p_id and status='draft' for update;if not found then raise exception 'NEGATIVE_HUMAN_IMMUTABLE';end if;
 select x into candidate from jsonb_array_elements(run.selection_pool) x where x->>'review_id'=p_item->>'review_id';if candidate is null then raise exception 'NEGATIVE_SELECTION_CHANGED';end if;
 if (candidate->>'overall_rating')::integer is distinct from (p_item->>'overall_rating')::integer or candidate->>'selection_bucket' is distinct from p_item->>'selection_bucket' or candidate->>'selection_hash' is distinct from p_item->>'selection_hash' or candidate->>'original_text_sha256' is distinct from p_item->>'original_text_sha256' or candidate->'normalized_category_ratings' is distinct from p_item->'normalized_category_ratings' or candidate->'original_language' is distinct from p_item->'original_language' then raise exception 'NEGATIVE_SELECTION_CHANGED';end if;
 select * into source from public.reviews where id=(p_item->>'review_id')::uuid and organization_id=run.organization_id and establishment_id=run.establishment_id;
 if source.id is null or btrim(coalesce(source.original_text,''))='' or encode(extensions.digest(source.original_text,'sha256'),'hex') is distinct from p_item->>'original_text_sha256' or source.original_language is distinct from p_item->>'original_language' then raise exception 'NEGATIVE_SOURCE_CHANGED';end if;
 if lower(split_part(replace(coalesce(source.original_language,''),'_','-'),'-',1))='en' then english=source.original_text;source_kind='original_en';else select translated_text into english from public.review_translations where review_id=source.id and language='en' and btrim(translated_text)<>'' limit 1;source_kind=case when english is null then 'english_pending' else 'google_translation_en' end;end if;
 if english is distinct from p_item->>'analysis_text' or source_kind is distinct from p_item->>'analysis_source' or (english is not null and encode(extensions.digest(english,'sha256'),'hex') is distinct from p_item->>'analysis_text_sha256') then raise exception 'NEGATIVE_ENGLISH_CHANGED';end if;
 insert into public.analysis_negative_validation_reviews(experiment_id,review_id,position,overall_rating,original_language,original_text_sha256,analysis_text,analysis_language,analysis_text_sha256,analysis_source,normalized_category_ratings,selection_bucket,selection_hash,published_at,preparation_error)
 values(p_id,source.id,(p_item->>'position')::integer,(p_item->>'overall_rating')::integer,p_item->>'original_language',p_item->>'original_text_sha256',english,case when english is null then null else 'en' end,p_item->>'analysis_text_sha256',source_kind,p_item->'normalized_category_ratings',p_item->>'selection_bucket',p_item->>'selection_hash',(p_item->>'published_at')::timestamptz,p_item->>'preparation_error');
end $$;
create function public.create_negative_validation(p_user uuid,p_organization uuid,p_establishment uuid,p_pool jsonb,p_items jsonb,p_rubric jsonb,p_config jsonb,p_rates jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid;item jsonb;candidate jsonb;expected jsonb;pool_count integer;bucket text;wanted integer;
begin
 if p_establishment is distinct from '252a8dca-14c7-4f09-bd1f-7b2c40ae97aa'::uuid or not exists(select 1 from public.establishments where id=p_establishment and organization_id=p_organization) or not exists(select 1 from public.organization_members where organization_id=p_organization and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('negative-validation:'||p_establishment::text,0));select id into result from public.analysis_negative_validation_runs where establishment_id=p_establishment and organization_id=p_organization and name='artisan-negative-validation-v1';if found then return result;end if;
 if jsonb_array_length(p_items)<>32 or (select count(distinct x->>'review_id') from jsonb_array_elements(p_items) x)<>32 or jsonb_array_length(p_pool)<>(select count(distinct x->>'review_id') from jsonb_array_elements(p_pool) x) then raise exception 'NEGATIVE_SELECTION_INVALID';end if;
 select count(*) into pool_count from public.reviews where organization_id=p_organization and establishment_id=p_establishment and btrim(coalesce(original_text,''))<>'' and rating between 1 and 5;
 if pool_count<>jsonb_array_length(p_pool) then raise exception 'NEGATIVE_SOURCE_CHANGED';end if;
 for candidate in select * from jsonb_array_elements(p_pool) loop
  if not exists(select 1 from public.reviews where id=(candidate->>'review_id')::uuid and organization_id=p_organization and establishment_id=p_establishment and rating=(candidate->>'overall_rating')::integer and btrim(coalesce(original_text,''))<>'' and encode(extensions.digest(original_text,'sha256'),'hex')=candidate->>'original_text_sha256') or candidate->>'selection_hash' is distinct from encode(extensions.digest(p_establishment::text||'negative-validation-v1'||(candidate->>'review_id'),'sha256'),'hex') or candidate->>'selection_bucket' is distinct from (case when (candidate->>'overall_rating')::integer<=3 then 'low' when (candidate->>'overall_rating')::integer=4 then 'mixed' else 'control' end) then raise exception 'NEGATIVE_SOURCE_CHANGED';end if;
 end loop;
 for bucket,wanted in select * from (values('low',20),('mixed',8),('control',4)) v loop
  select jsonb_agg(x->>'review_id' order by x->>'selection_hash',x->>'review_id') into expected from (select x from jsonb_array_elements(p_pool) x where x->>'selection_bucket'=bucket order by x->>'selection_hash',x->>'review_id' limit wanted) q;
  if jsonb_array_length(expected)<>wanted or (select jsonb_agg(x->>'review_id' order by x->>'selection_hash',x->>'review_id') from jsonb_array_elements(p_items) x where x->>'selection_bucket'=bucket) is distinct from expected then raise exception 'NEGATIVE_SELECTION_INVALID';end if;
 end loop;
 if coalesce(jsonb_typeof(p_rubric),'null')<>'object' or (select count(*) from jsonb_object_keys(p_rubric))<>25 or p_config->'v9'->>'question_set' is distinct from 'themes_phase2_v7' or p_config->'v11'->>'question_set' is distinct from 'themes_v11_human_aligned_v1' or p_config->'v11'->>'threshold_version' is distinct from 'jev-theme-thresholds-v2' or p_config->>'concurrency' is distinct from '8' then raise exception 'NEGATIVE_CONFIG_INVALID';end if;
 if coalesce(jsonb_typeof(p_rates->'jev_input'),'null')<>'number' or (p_rates->>'jev_input')::double precision<0 then raise exception 'NEGATIVE_COST_RATE_INVALID';end if;
 insert into public.analysis_negative_validation_runs(organization_id,establishment_id,name,methodology,rubric_version,rubric,selection_pool,model_config,rates,created_by)
 values(p_organization,p_establishment,'artisan-negative-validation-v1','independent_negative_mixed_validation','human-aligned-review-rubric-v1',p_rubric,p_pool,p_config,p_rates,p_user) returning id into result;
 for item in select * from jsonb_array_elements(p_items) loop perform public.insert_negative_review(result,item);end loop;
 insert into public.analysis_negative_validation_events(experiment_id,actor_user_id,action,payload) values(result,p_user,'created',jsonb_build_object('review_count',32,'strata',jsonb_build_object('low',20,'mixed',8,'control',4)));return result;
end $$;
create function public.write_negative_validation(p_user uuid,p_id uuid,p_revision integer,p_action text,p_payload jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare r public.analysis_negative_validation_runs;i public.analysis_negative_validation_reviews;source public.reviews;update_row jsonb;english text;kind text;label_key text;previous jsonb;replacement jsonb;model text;rep integer;
begin
 select * into r from public.analysis_negative_validation_runs where id=p_id for update;
 if r.id is null or not exists(select 1 from public.organization_members where organization_id=r.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if p_action='start_benchmark' and r.benchmark_status<>'idle' then return r.revision;end if;
 if r.revision is distinct from p_revision then raise exception 'NEGATIVE_REVISION_CHANGED';end if;
 if r.status='completed' and p_action<>'start_benchmark' then raise exception 'NEGATIVE_HUMAN_IMMUTABLE';end if;
 if p_action='refresh_english' then
  for update_row in select * from jsonb_array_elements(p_payload->'updates') loop
   select * into i from public.analysis_negative_validation_reviews where experiment_id=p_id and review_id=(update_row->>'review_id')::uuid and not excluded and analysis_text is null;if not found then continue;end if;
   select * into source from public.reviews where id=i.review_id and organization_id=r.organization_id and establishment_id=r.establishment_id;
   if source.id is null then update public.analysis_negative_validation_reviews set preparation_error='SOURCE_REVIEW_MISSING' where experiment_id=p_id and review_id=i.review_id;continue;end if;
   if source.original_language is distinct from i.original_language or encode(extensions.digest(coalesce(source.original_text,''),'sha256'),'hex') is distinct from i.original_text_sha256 then update public.analysis_negative_validation_reviews set preparation_error='ORIGINAL_SOURCE_CHANGED' where experiment_id=p_id and review_id=i.review_id;continue;end if;
   english=null;if lower(split_part(replace(coalesce(source.original_language,''),'_','-'),'-',1))='en' then english=source.original_text;kind='original_en';else select translated_text into english from public.review_translations where review_id=i.review_id and language='en' and btrim(translated_text)<>'' limit 1;kind=case when english is null then 'english_pending' else 'google_translation_en' end;end if;
   if english is distinct from update_row->>'analysis_text' then raise exception 'NEGATIVE_ENGLISH_CHANGED';end if;
   update public.analysis_negative_validation_reviews set analysis_text=english,analysis_language=case when english is null then null else 'en' end,analysis_source=kind,analysis_text_sha256=case when english is null then null else encode(extensions.digest(english,'sha256'),'hex') end,preparation_error=case when english is null then 'ENGLISH_TRANSLATION_MISSING' else null end where experiment_id=p_id and review_id=i.review_id;
  end loop;
 elsif p_action='exclude_review' then
  select * into i from public.analysis_negative_validation_reviews where experiment_id=p_id and review_id=(p_payload->>'review_id')::uuid and not excluded;if not found then raise exception 'NEGATIVE_REVIEW_NOT_ACTIVE';end if;
  replacement=p_payload->'replacement';if replacement->>'selection_bucket' is distinct from i.selection_bucket or (replacement->>'position')::integer is distinct from i.position or exists(select 1 from public.analysis_negative_validation_reviews where experiment_id=p_id and review_id=(replacement->>'review_id')::uuid) or replacement->>'review_id' is distinct from (select x->>'review_id' from jsonb_array_elements(r.selection_pool) x where x->>'selection_bucket'=i.selection_bucket and not exists(select 1 from public.analysis_negative_validation_reviews used where used.experiment_id=p_id and used.review_id::text=x->>'review_id') order by x->>'selection_hash',x->>'review_id' limit 1) then raise exception 'NEGATIVE_REPLACEMENT_INVALID';end if;
  update public.analysis_negative_validation_reviews set excluded=true,exclusion_reason='translation_issue' where experiment_id=p_id and review_id=i.review_id;perform public.insert_negative_review(p_id,replacement);
  insert into public.analysis_negative_validation_events(experiment_id,actor_user_id,action,payload) values(p_id,p_user,'translation_replacement',jsonb_build_object('excluded_review_id',i.review_id,'replacement_review_id',replacement->>'review_id','position',i.position));
 elsif p_action in ('confirm_review','finalize_human','start_benchmark') then
  if (select count(*) from public.analysis_negative_validation_reviews where experiment_id=p_id and not excluded)<>32 or exists(select 1 from public.analysis_negative_validation_reviews where experiment_id=p_id and not excluded and (analysis_language is distinct from 'en' or analysis_text is null or btrim(analysis_text)='' or encode(extensions.digest(analysis_text,'sha256'),'hex') is distinct from analysis_text_sha256)) then raise exception 'NEGATIVE_ENGLISH_REQUIRED';end if;
  if p_action='confirm_review' then
   select * into i from public.analysis_negative_validation_reviews where experiment_id=p_id and review_id=(p_payload->>'review_id')::uuid and not excluded;if not found then raise exception 'NEGATIVE_REVIEW_NOT_ACTIVE';end if;
   if (select count(*) from jsonb_object_keys(p_payload->'choices'))<>25 or exists(select 1 from jsonb_object_keys(p_payload->'choices') k where not(r.rubric ? k)) then raise exception 'NEGATIVE_CHOICES_INVALID';end if;
   select jsonb_object_agg(theme_key,choice) into previous from public.analysis_negative_validation_labels where experiment_id=p_id and review_id=i.review_id;
   for label_key in select * from jsonb_object_keys(p_payload->'choices') loop insert into public.analysis_negative_validation_labels(experiment_id,review_id,theme_key,choice,annotator_user_id) values(p_id,i.review_id,label_key,p_payload->'choices'->>label_key,p_user) on conflict(experiment_id,review_id,theme_key) do update set choice=excluded.choice,annotator_user_id=p_user,updated_at=now();end loop;
   update public.analysis_negative_validation_reviews set confirmed_at=now(),confirmed_by=p_user where experiment_id=p_id and review_id=i.review_id;
   insert into public.analysis_negative_validation_events(experiment_id,actor_user_id,action,payload) values(p_id,p_user,'review_confirmed',jsonb_build_object('review_id',i.review_id,'previous_choices',previous,'choices',p_payload->'choices'));
  else
   if exists(select 1 from public.analysis_negative_validation_reviews i2 where i2.experiment_id=p_id and not i2.excluded and (i2.confirmed_at is null or (select count(*) from public.analysis_negative_validation_labels l where l.experiment_id=p_id and l.review_id=i2.review_id)<>25)) then raise exception 'NEGATIVE_ANNOTATION_INCOMPLETE';end if;
   if p_action='finalize_human' then
    if not(coalesce(p_payload->>'dataset_fingerprint','')~'^[a-f0-9]{64}$') or not(coalesce(p_payload->>'label_fingerprint','')~'^[a-f0-9]{64}$') then raise exception 'NEGATIVE_FINGERPRINT_REQUIRED';end if;
    update public.analysis_negative_validation_runs set status='completed',human_completed_at=now(),dataset_fingerprint=p_payload->>'dataset_fingerprint',label_fingerprint=p_payload->>'label_fingerprint' where id=p_id;
   else
    if r.status<>'completed' then raise exception 'NEGATIVE_HUMAN_REQUIRED';end if;
    update public.analysis_negative_validation_runs set benchmark_status='queued' where id=p_id;
    insert into public.analysis_negative_validation_tasks(experiment_id,model_version,review_id,review_alias,question_set_version,repeat)
    select p_id,v.model,i2.review_id,'r'||i2.position,case when v.model='v9' then 'themes_phase2_v7' else 'themes_v11_human_aligned_v1' end,n from public.analysis_negative_validation_reviews i2 cross join (values('v9'),('v11')) v(model) cross join generate_series(1,3) n where i2.experiment_id=p_id and not i2.excluded;
   end if;
  end if;
 else raise exception 'NEGATIVE_ACTION_INVALID';end if;
 if p_action not in ('confirm_review','exclude_review') then insert into public.analysis_negative_validation_events(experiment_id,actor_user_id,action) values(p_id,p_user,p_action);end if;
 update public.analysis_negative_validation_runs set revision=revision+1 where id=p_id;return r.revision+1;
end $$;

revoke all on function public.insert_negative_review(uuid,jsonb),public.create_negative_validation(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb),public.write_negative_validation(uuid,uuid,integer,text,jsonb),public.claim_negative_validation_jobs(uuid),public.claim_negative_validation_tasks(uuid,uuid),public.complete_negative_validation_task(uuid,uuid,uuid,jsonb),public.finish_negative_validation_tick(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.insert_negative_review(uuid,jsonb),public.create_negative_validation(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb),public.write_negative_validation(uuid,uuid,integer,text,jsonb),public.claim_negative_validation_jobs(uuid),public.claim_negative_validation_tasks(uuid,uuid),public.complete_negative_validation_task(uuid,uuid,uuid,jsonb),public.finish_negative_validation_tick(uuid,uuid,jsonb,text) to service_role;

-- Cron only wakes a manually queued experiment; an empty deployment makes no HTTP/provider call.
select cron.schedule('home-reviews-negative-validation-worker-v1','* * * * *',$cron$
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-negative-validation-jobs',headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),body:='{}'::jsonb,timeout_milliseconds:=180000)
 where exists(select 1 from public.analysis_negative_validation_runs where benchmark_status in ('queued','running') and (lease_until is null or lease_until<=now()));
$cron$);
