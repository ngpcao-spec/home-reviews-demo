-- New exploratory path only. Existing human validation guards/data are untouched.
create table public.analysis_jev_exploratory_runs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 establishment_id uuid not null references public.establishments(id), source_kind text not null check(source_kind in ('negative_validation','historical_v11')),
 source_id uuid not null, status text not null default 'idle' check(status in ('idle','queued','running','completed','failed')),
 dataset_sha256 text not null check(dataset_sha256 ~ '^[a-f0-9]{64}$'), config jsonb not null,
 rate double precision not null check(rate>=0), created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 started_at timestamptz, completed_at timestamptz, error_code text, locked_by uuid, lease_until timestamptz,
 unique(organization_id,source_kind,source_id)
);
create table public.analysis_jev_exploratory_items (
 run_id uuid not null references public.analysis_jev_exploratory_runs(id), review_id uuid not null,
 position integer not null check(position>0), analysis_text text not null check(btrim(analysis_text)<>''),
 analysis_text_sha256 text not null check(analysis_text_sha256 ~ '^[a-f0-9]{64}$'), overall_rating smallint not null check(overall_rating between 1 and 5),
 normalized_category_ratings jsonb not null, v9 jsonb not null default '{}', v11 jsonb not null default '{}',
 primary key(run_id,review_id), unique(run_id,position)
);
create table public.analysis_jev_exploratory_tasks (
 id uuid primary key default gen_random_uuid(), run_id uuid not null, review_id uuid not null,
 repeat integer not null check(repeat between 1 and 3), status text not null default 'pending' check(status in ('pending','running','completed','failed')),
 response jsonb, served_model text, input_tokens bigint not null default 0, output_tokens bigint not null default 0,
 request_count integer not null default 0, retry_count integer not null default 0, cost_usd double precision not null default 0,
 duration_ms bigint not null default 0, error_code text, usage_complete boolean not null default true,
 locked_by uuid, started_at timestamptz, completed_at timestamptz,
 foreign key(run_id,review_id) references public.analysis_jev_exploratory_items(run_id,review_id), unique(run_id,review_id,repeat)
);
create index jev_exploratory_pending on public.analysis_jev_exploratory_tasks(run_id,status);
create table public.analysis_jev_exploratory_approvals (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.analysis_jev_exploratory_runs(id),
 bundle_sha256 text not null check(bundle_sha256 ~ '^[a-f0-9]{64}$'), review_ids jsonb not null,
 approved_by uuid not null references auth.users(id), approved_at timestamptz not null default now(),
 unique(run_id,bundle_sha256)
);
create table public.analysis_jev_exploratory_corrections (
 id uuid primary key default gen_random_uuid(), run_id uuid not null, approval_id uuid not null references public.analysis_jev_exploratory_approvals(id),
 import_id uuid not null, review_id uuid not null, theme_key text not null, jev_version integer not null default 11 check(jev_version=11),
 initial_prediction jsonb not null, choice text not null check(choice in ('absent','positive','negative','both','uncertain')),
 justification text not null check(btrim(justification)<>''), corrector_model text not null check(btrim(corrector_model)<>''),
 corrected_at timestamptz not null, imported_by uuid not null references auth.users(id), imported_at timestamptz not null default now(),
 analysis_text_sha256 text not null, label_source text not null default 'chatgpt_ai_correction' check(label_source='chatgpt_ai_correction'),
 foreign key(run_id,review_id) references public.analysis_jev_exploratory_items(run_id,review_id),
 unique(approval_id,review_id,theme_key), unique(import_id,review_id,theme_key)
);
create index jev_exploratory_correction_review on public.analysis_jev_exploratory_corrections(review_id);
create index jev_exploratory_correction_run on public.analysis_jev_exploratory_corrections(run_id,imported_at);
create table public.analysis_jev_exploratory_events (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.analysis_jev_exploratory_runs(id),
 actor_user_id uuid references auth.users(id), action text not null, payload jsonb not null default '{}', created_at timestamptz not null default now()
);
-- Review IDs (not just text hashes) are separated for every explicitly named future version.
create table public.analysis_jev_exploratory_review_uses (
 organization_id uuid not null references public.organizations(id), future_version integer not null check(future_version>11),
 review_id uuid not null, purpose text not null check(purpose in ('calibration','evaluation')),
 source_run_id uuid not null references public.analysis_jev_exploratory_runs(id), created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), primary key(organization_id,future_version,review_id)
);
do $$ declare t text;begin
 foreach t in array array['analysis_jev_exploratory_runs','analysis_jev_exploratory_items','analysis_jev_exploratory_tasks','analysis_jev_exploratory_approvals','analysis_jev_exploratory_corrections','analysis_jev_exploratory_events','analysis_jev_exploratory_review_uses'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 if t in ('analysis_jev_exploratory_runs','analysis_jev_exploratory_review_uses') then
 execute format('create policy jev_exploratory_read on public.%I for select to authenticated using (exists(select 1 from public.organization_members m where m.organization_id=%I.organization_id and m.user_id=(select auth.uid()) and m.role in (''owner'',''admin'',''manager'')))',t,t);
 else
 execute format('create policy jev_exploratory_read on public.%I for select to authenticated using (exists(select 1 from public.analysis_jev_exploratory_runs r join public.organization_members m on m.organization_id=r.organization_id where r.id=%I.run_id and m.user_id=(select auth.uid()) and m.role in (''owner'',''admin'',''manager'')))',t,t);
 end if;
 end loop;end $$;
create function public.jev_exploratory_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'EXPLORATORY_IMMUTABLE';end if;
 if tg_table_name='analysis_jev_exploratory_runs' then
  if (to_jsonb(new)-array['status','started_at','completed_at','error_code','locked_by','lease_until']) is distinct from (to_jsonb(old)-array['status','started_at','completed_at','error_code','locked_by','lease_until']) or old.status in ('completed','failed') then raise exception 'EXPLORATORY_IMMUTABLE';end if;
 elsif tg_table_name='analysis_jev_exploratory_items' then
  if (to_jsonb(new)-'v11') is distinct from (to_jsonb(old)-'v11') or exists(select 1 from public.analysis_jev_exploratory_runs where id=old.run_id and status in ('completed','failed')) then raise exception 'EXPLORATORY_IMMUTABLE';end if;
 elsif tg_table_name='analysis_jev_exploratory_tasks' then
  if old.status in ('completed','failed') or (to_jsonb(new)-array['status','response','served_model','input_tokens','output_tokens','request_count','retry_count','cost_usd','duration_ms','error_code','usage_complete','locked_by','started_at','completed_at']) is distinct from (to_jsonb(old)-array['status','response','served_model','input_tokens','output_tokens','request_count','retry_count','cost_usd','duration_ms','error_code','usage_complete','locked_by','started_at','completed_at']) then raise exception 'EXPLORATORY_IMMUTABLE';end if;
 else raise exception 'EXPLORATORY_IMMUTABLE';
 end if;return new;
end $$;
do $$ declare t text;begin foreach t in array array['analysis_jev_exploratory_runs','analysis_jev_exploratory_items','analysis_jev_exploratory_tasks','analysis_jev_exploratory_approvals','analysis_jev_exploratory_corrections','analysis_jev_exploratory_events','analysis_jev_exploratory_review_uses'] loop
 execute format('create trigger jev_exploratory_immutable before update or delete on public.%I for each row execute function public.jev_exploratory_immutable()',t);end loop;end $$;

create function public.create_jev_exploration(p_user uuid,p_org uuid,p_establishment uuid,p_kind text,p_source uuid,p_items jsonb,p_fingerprint text,p_config jsonb,p_rate double precision) returns uuid language plpgsql security invoker set search_path='' as $$
declare rid uuid;item jsonb;src jsonb;total integer;
begin
 if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('jev-exploratory:'||p_kind||p_source::text,0));
 select id into rid from public.analysis_jev_exploratory_runs where organization_id=p_org and source_kind=p_kind and source_id=p_source;if found then return rid;end if;
 if p_kind='negative_validation' then
  if not exists(select 1 from public.analysis_negative_validation_runs where id=p_source and organization_id=p_org and establishment_id=p_establishment) then raise exception 'FORBIDDEN';end if;
  select count(*) into total from public.analysis_negative_validation_reviews where experiment_id=p_source and not excluded;
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
  if p_kind='negative_validation' then select to_jsonb(i) into src from public.analysis_negative_validation_reviews i where experiment_id=p_source and review_id=(item->>'review_id')::uuid and not excluded;
  else select x into src from public.historical_report_runs h cross join jsonb_array_elements(h.snapshot->'reviews') x where h.id=p_source and x->>'id'=item->>'review_id';end if;
  if src is null or src->>'analysis_language' is distinct from 'en' or btrim(coalesce(src->>'analysis_text',''))='' or src->>'analysis_text' is distinct from item->>'analysis_text' or encode(extensions.digest(item->>'analysis_text','sha256'),'hex') is distinct from item->>'analysis_text_sha256' then raise exception 'EXPLORATORY_ENGLISH_REQUIRED';end if;
  if p_kind='negative_validation' then
   if src->>'analysis_source' not in ('original_en','google_translation_en') or src->>'overall_rating' is distinct from item->>'overall_rating' or src->'normalized_category_ratings' is distinct from item->'normalized_category_ratings' then raise exception 'EXPLORATORY_SOURCE_CHANGED';end if;
  else
   if src->>'rating' is distinct from item->>'overall_rating' or src->'normalized_category_ratings' is distinct from item->'normalized_category_ratings' then raise exception 'EXPLORATORY_SOURCE_CHANGED';end if;
  end if;
  insert into public.analysis_jev_exploratory_items(run_id,review_id,position,analysis_text,analysis_text_sha256,overall_rating,normalized_category_ratings,v9,v11) values(rid,(item->>'review_id')::uuid,(item->>'position')::integer,item->>'analysis_text',item->>'analysis_text_sha256',(item->>'overall_rating')::integer,item->'normalized_category_ratings',item->'v9',item->'v11');
 end loop;
 if not exists(select 1 from public.analysis_jev_exploratory_items where run_id=rid and (select count(*) from jsonb_object_keys(v11))<>25) then update public.analysis_jev_exploratory_runs set status='completed',completed_at=now() where id=rid;end if;
 insert into public.analysis_jev_exploratory_events(run_id,actor_user_id,action) values(rid,p_user,'created');return rid;
end $$;
create function public.write_jev_exploration(p_user uuid,p_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jev_exploratory_runs;a public.analysis_jev_exploratory_approvals;row_data jsonb;approval uuid;rid uuid;requested_version integer;role_kind text;protected boolean;
begin
 select * into r from public.analysis_jev_exploratory_runs where id=p_id for update;
 if r.id is null or not exists(select 1 from public.organization_members where organization_id=r.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if p_action='start' then
  if p_payload->>'confirm' is distinct from 'true' then raise exception 'EXPLORATORY_PAYMENT_CONFIRMATION_REQUIRED';end if;
  if r.status<>'idle' then return jsonb_build_object('status',r.status);end if;
  insert into public.analysis_jev_exploratory_tasks(run_id,review_id,repeat) select r.id,i.review_id,n from public.analysis_jev_exploratory_items i cross join generate_series(1,3) n where i.run_id=r.id and (select count(*) from jsonb_object_keys(i.v11))<>25;
  update public.analysis_jev_exploratory_runs set status='queued' where id=r.id;
 elsif p_action='approve' then
  if r.status<>'completed' or p_payload->>'confirm' is distinct from 'true' or jsonb_array_length(p_payload->'review_ids')=0 or exists(select 1 from jsonb_array_elements_text(p_payload->'review_ids') k where not exists(select 1 from public.analysis_jev_exploratory_items where run_id=p_id and review_id::text=k)) then raise exception 'EXPLORATORY_GO_REQUIRED';end if;
  for rid in select value::uuid from jsonb_array_elements_text(p_payload->'review_ids') order by value loop
   perform pg_advisory_xact_lock(hashtextextended(r.organization_id::text||rid::text,0));
   if exists(select 1 from public.analysis_jev_exploratory_review_uses where organization_id=r.organization_id and review_id=rid and purpose='evaluation') then raise exception 'EXPLORATORY_EVALUATION_CONTAMINATION';end if;
  end loop;
  insert into public.analysis_jev_exploratory_approvals(run_id,bundle_sha256,review_ids,approved_by) values(p_id,p_payload->>'bundle_sha256',p_payload->'review_ids',p_user) on conflict(run_id,bundle_sha256) do nothing;
  select id into approval from public.analysis_jev_exploratory_approvals where run_id=p_id and bundle_sha256=p_payload->>'bundle_sha256';return jsonb_build_object('approval_id',approval);
 elsif p_action='import' then
  if r.status<>'completed' then raise exception 'EXPLORATORY_NOT_COMPLETED';end if;
  select * into a from public.analysis_jev_exploratory_approvals where id=(p_payload->>'approval_id')::uuid and run_id=p_id;
  if a.id is null or a.bundle_sha256 is distinct from p_payload->>'bundle_sha256' then raise exception 'EXPLORATORY_GO_REQUIRED';end if;
  if exists(select 1 from public.analysis_jev_exploratory_corrections where import_id=(p_payload->>'import_id')::uuid and run_id=p_id) then return jsonb_build_object('reused',true);end if;
  if exists(select 1 from public.analysis_jev_exploratory_corrections where approval_id=a.id) then raise exception 'EXPLORATORY_IMPORT_IMMUTABLE';end if;
  for row_data in select * from jsonb_array_elements(p_payload->'corrections') order by value->>'review_id',value->>'theme_key' loop
   perform pg_advisory_xact_lock(hashtextextended(r.organization_id::text||(row_data->>'review_id'),0));
   if not(a.review_ids ? (row_data->>'review_id')) or not(r.config->'thresholds' ? (row_data->>'theme_key')) or row_data->>'label_source' is distinct from 'chatgpt_ai_correction' or not exists(select 1 from public.analysis_jev_exploratory_items where run_id=p_id and review_id=(row_data->>'review_id')::uuid and analysis_text_sha256=row_data->>'analysis_text_sha256' and v11->(row_data->>'theme_key')=row_data->'initial_prediction') then raise exception 'EXPLORATORY_CORRECTIONS_INVALID';end if;
   -- Corrected reviews are quarantined from all future independent evaluations.
   if exists(select 1 from public.analysis_jev_exploratory_review_uses where organization_id=r.organization_id and review_id=(row_data->>'review_id')::uuid and purpose='evaluation') then raise exception 'EXPLORATORY_EVALUATION_CONTAMINATION';end if;
   insert into public.analysis_jev_exploratory_corrections(run_id,approval_id,import_id,review_id,theme_key,initial_prediction,choice,justification,corrector_model,corrected_at,imported_by,analysis_text_sha256)
   values(p_id,a.id,(p_payload->>'import_id')::uuid,(row_data->>'review_id')::uuid,row_data->>'theme_key',row_data->'initial_prediction',row_data->>'choice',row_data->>'justification',row_data->>'corrector_model',(row_data->>'corrected_at')::timestamptz,p_user,row_data->>'analysis_text_sha256');
  end loop;
 elsif p_action='reserve' then
  requested_version=(p_payload->>'future_version')::integer;role_kind=p_payload->>'purpose';
  if requested_version<=11 or role_kind not in ('calibration','evaluation') or jsonb_array_length(p_payload->'review_ids')=0 then raise exception 'EXPLORATORY_USAGE_INVALID';end if;
  for rid in select value::uuid from jsonb_array_elements_text(p_payload->'review_ids') loop
   if not exists(select 1 from public.analysis_jev_exploratory_items where run_id=p_id and review_id=rid) then raise exception 'EXPLORATORY_USAGE_INVALID';end if;
   perform pg_advisory_xact_lock(hashtextextended(r.organization_id::text||rid::text,0));
   if exists(select 1 from public.analysis_jev_exploratory_review_uses where organization_id=r.organization_id and future_version=requested_version and review_id=rid and purpose<>role_kind) then raise exception 'EXPLORATORY_EVALUATION_CONTAMINATION';end if;
   if role_kind='evaluation' and (exists(select 1 from public.analysis_jev_exploratory_corrections c join public.analysis_jev_exploratory_runs cr on cr.id=c.run_id where cr.organization_id=r.organization_id and c.review_id=rid) or exists(select 1 from public.analysis_jev_exploratory_approvals g join public.analysis_jev_exploratory_runs gr on gr.id=g.run_id where gr.organization_id=r.organization_id and g.review_ids ? rid::text)) then raise exception 'EXPLORATORY_EVALUATION_CONTAMINATION';end if;
   if role_kind='calibration' and to_regclass('public.analysis_v11_independent_holdout_items') is not null then
    execute 'select exists(select 1 from public.analysis_v11_independent_holdout_items i join public.analysis_v11_independent_holdout_sets s on s.id=i.holdout_id where s.organization_id=$1 and i.review_id=$2)' into protected using r.organization_id,rid;
    if protected then raise exception 'EXPLORATORY_PROTECTED_HOLDOUT';end if;
   end if;
   insert into public.analysis_jev_exploratory_review_uses(organization_id,future_version,review_id,purpose,source_run_id,created_by) values(r.organization_id,requested_version,rid,role_kind,p_id,p_user) on conflict do nothing;
  end loop;
 else raise exception 'EXPLORATORY_ACTION_INVALID';end if;
 insert into public.analysis_jev_exploratory_events(run_id,actor_user_id,action,payload) values(p_id,p_user,p_action,case when p_action='import' then jsonb_build_object('import_id',p_payload->'import_id','approval_id',a.id,'count',jsonb_array_length(p_payload->'corrections')) else p_payload end);
 return jsonb_build_object('status',r.status);
end $$;
create function public.claim_jev_explorations(p_worker uuid) returns setof public.analysis_jev_exploratory_runs language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jev_exploratory_runs;
begin
 perform pg_advisory_xact_lock(hashtextextended('jev-exploratory-worker',0));
 if exists(select 1 from public.analysis_jev_exploratory_runs where status='running' and lease_until>now()) then return;end if;
 select * into r from public.analysis_jev_exploratory_runs where status='queued' or(status='running' and (lease_until is null or lease_until<=now())) order by created_at for update skip locked limit 1;if not found then return;end if;
 update public.analysis_jev_exploratory_tasks set status='failed',error_code='JEV_RESPONSE_UNCONFIRMED',usage_complete=false,completed_at=now() where run_id=r.id and status='running';
 return query update public.analysis_jev_exploratory_runs set status='running',started_at=coalesce(started_at,now()),locked_by=p_worker,lease_until=now()+interval '240 seconds' where id=r.id returning *;
end $$;
create function public.claim_jev_exploratory_tasks(p_id uuid,p_worker uuid) returns setof public.analysis_jev_exploratory_tasks language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.analysis_jev_exploratory_runs where id=p_id and status='running' and locked_by=p_worker and lease_until>now()) then raise exception 'EXPLORATORY_LEASE_LOST';end if;
 return query update public.analysis_jev_exploratory_tasks set status='running',locked_by=p_worker,started_at=now() where id in (select id from public.analysis_jev_exploratory_tasks where run_id=p_id and status='pending' order by review_id,repeat for update skip locked limit 8) returning *;
end $$;
create function public.complete_jev_exploratory_task(p_id uuid,p_worker uuid,p_task uuid,p_values jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jev_exploratory_runs;
begin
 select * into r from public.analysis_jev_exploratory_runs where id=p_id and locked_by=p_worker and status='running' and lease_until>now() for update;if not found then return false;end if;
 update public.analysis_jev_exploratory_tasks set status=p_values->>'status',response=p_values->'response',served_model=p_values->>'served_model',input_tokens=(p_values->>'input_tokens')::bigint,output_tokens=(p_values->>'output_tokens')::bigint,request_count=(p_values->>'request_count')::integer,retry_count=(p_values->>'retry_count')::integer,cost_usd=(p_values->>'input_tokens')::double precision/1000000*r.rate,duration_ms=(p_values->>'duration_ms')::bigint,error_code=p_values->>'error_code',usage_complete=(p_values->>'usage_complete')::boolean,completed_at=now() where id=p_task and run_id=p_id and locked_by=p_worker and status='running';if not found then return false;end if;
 update public.analysis_jev_exploratory_runs set lease_until=now()+interval '240 seconds' where id=p_id;return true;
end $$;
create function public.finish_jev_exploratory_tick(p_id uuid,p_worker uuid,p_items jsonb default null,p_error text default null) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.analysis_jev_exploratory_runs;i jsonb;
begin
 select * into r from public.analysis_jev_exploratory_runs where id=p_id and status='running' and locked_by=p_worker and lease_until>now() for update;if not found then return false;end if;
 if p_error is not null then
  update public.analysis_jev_exploratory_runs set status='failed',completed_at=now(),error_code=p_error,locked_by=null,lease_until=null where id=p_id;
 elsif p_items is not null then
  if exists(select 1 from public.analysis_jev_exploratory_tasks where run_id=p_id and status in ('pending','running')) then raise exception 'EXPLORATORY_TASKS_PENDING';end if;
  for i in select * from jsonb_array_elements(p_items) loop update public.analysis_jev_exploratory_items set v11=i->'v11' where run_id=p_id and review_id=(i->>'review_id')::uuid;end loop;
  update public.analysis_jev_exploratory_runs set status='completed',completed_at=now(),locked_by=null,lease_until=null where id=p_id;
  insert into public.analysis_jev_exploratory_events(run_id,action) values(p_id,'jev_completed');
 else update public.analysis_jev_exploratory_runs set locked_by=null,lease_until=null where id=p_id;
 end if;return true;
end $$;
revoke all on function public.jev_exploratory_immutable(),public.create_jev_exploration(uuid,uuid,uuid,text,uuid,jsonb,text,jsonb,double precision),public.write_jev_exploration(uuid,uuid,text,jsonb),public.claim_jev_explorations(uuid),public.claim_jev_exploratory_tasks(uuid,uuid),public.complete_jev_exploratory_task(uuid,uuid,uuid,jsonb),public.finish_jev_exploratory_tick(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.create_jev_exploration(uuid,uuid,uuid,text,uuid,jsonb,text,jsonb,double precision),public.write_jev_exploration(uuid,uuid,text,jsonb),public.claim_jev_explorations(uuid),public.claim_jev_exploratory_tasks(uuid,uuid),public.complete_jev_exploratory_task(uuid,uuid,uuid,jsonb),public.finish_jev_exploratory_tick(uuid,uuid,jsonb,text) to service_role;
select cron.schedule('home-reviews-jev-exploratory-worker-v1','* * * * *',$cron$
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-jev-exploratory-jobs',headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),body:='{}'::jsonb,timeout_milliseconds:=180000)
 where exists(select 1 from public.analysis_jev_exploratory_runs where status in ('queued','running') and (lease_until is null or lease_until<=now()));
$cron$);
