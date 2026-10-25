-- One publication-date policy for all ratings. Rollout stays paused until the
-- encrypted restoration point and the inspected production cleanup succeed.
alter table public.review_corpus_policy add column ingestions_paused boolean not null default true;
alter table public.review_corpus_policy add column backup_verified_sha256 text;
grant usage on schema private to service_role;

create table public.review_corpus_states(
 establishment_id uuid primary key references public.establishments(id),
 organization_id uuid not null references public.organizations(id),
 policy_epoch uuid not null, checked_at timestamptz not null,
 retained_count integer not null check(retained_count between 0 and 100),
 period_start timestamptz,period_end timestamptz,fingerprint text not null,
 changed_at timestamptz not null default now()
);
create table public.review_observation_totals(
 establishment_id uuid primary key references public.establishments(id),
 organization_id uuid not null references public.organizations(id),
 observed_reviews bigint not null default 0,
 observed_textless_reviews bigint not null default 0,
 textless_star_counts jsonb not null default '{"1":0,"2":0,"3":0,"4":0,"5":0}',
 first_observed_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table private.review_seen_keys(
 establishment_id uuid not null references public.establishments(id),
 external_key_sha256 text not null check(length(external_key_sha256)=64),
 first_published_at timestamptz,first_seen_at timestamptz not null default now(),
 primary key(establishment_id,external_key_sha256)
);
create table public.report_corpus_scopes(
 source_run_id uuid primary key references public.historical_report_runs(id),
 organization_id uuid not null references public.organizations(id),
 establishment_id uuid not null references public.establishments(id),
 policy_epoch uuid not null,as_of timestamptz not null,cutoff timestamptz not null,
 review_ids uuid[] not null,review_count integer not null check(review_count between 1 and 100),
 period_start timestamptz not null,period_end timestamptz not null,
 fingerprint text not null,stale boolean not null default false,stale_reason text
);
create table private.retired_report_scopes(
 establishment_id uuid not null references public.establishments(id),language text not null,
 organization_id uuid not null references public.organizations(id),
 report_id uuid,source_run_id uuid,generated_at timestamptz,
 review_count integer not null,period_start timestamptz,period_end timestamptz,
 retired_at timestamptz not null default now(),reason text not null,
 primary key(establishment_id,language)
);
create table private.retired_generation_keys(
 request_id uuid primary key,source_run_id uuid not null,
 retired_at timestamptz not null default now(),policy_epoch uuid not null
);
create table private.provider_attempt_ledger(
 source_relation text not null,source_key text not null,phase text not null,
 organization_id uuid,establishment_id uuid,provider text,model text,
 attempts integer not null check(attempts>0),outcome text not null,
 request_sha256 text,receipt_sha256 text,provider_request_id text,
 input_tokens bigint,output_tokens bigint,cache_read_tokens bigint,cache_write_tokens bigint,
 duration_ms numeric,usage_complete boolean not null default false,
 started_at timestamptz,completed_at timestamptz,recorded_at timestamptz not null default now(),
 accounting_scope text not null default 'native_attempt',
 primary key(source_relation,source_key,phase)
);
create index provider_attempt_unknown_hash on private.provider_attempt_ledger(provider,request_sha256) where outcome='unknown';
create table public.review_retention_events(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,
 establishment_id uuid not null,policy_epoch uuid not null,as_of timestamptz not null,
 cutoff timestamptz not null,before_count integer not null,after_count integer not null,
 purged_count integer not null,created_at timestamptz not null default now()
);

do $$declare t text;begin
 foreach t in array array['review_corpus_states','review_observation_totals','report_corpus_scopes','review_retention_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
  execute format('create policy organization_read on public.%I for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=%I.organization_id and m.user_id=(select auth.uid())))',t,t);
 end loop;
 foreach t in array array['review_seen_keys','retired_report_scopes','retired_generation_keys','provider_attempt_ledger'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on private.%I to service_role',t);
 end loop;
end $$;

create function public.review_usable_text(p_original text,p_text text) returns text
language sql immutable set search_path='' as $$
 select coalesce(nullif(btrim(p_original,E' \n\r\t'||chr(160)||chr(8203)||chr(65279)),''),nullif(btrim(p_text,E' \n\r\t'||chr(160)||chr(8203)||chr(65279)),''))
$$;
create function public.recent_review_cutoff(p_as_of timestamptz) returns timestamptz
language sql immutable set search_path='' as $$
 select ((p_as_of at time zone 'Asia/Ho_Chi_Minh')-interval '6 months') at time zone 'Asia/Ho_Chi_Minh'
$$;
create function public.retained_review_ids(p_establishment uuid,p_as_of timestamptz default now())
returns setof uuid language sql stable set search_path='' as $$
 with candidates as (
  select r.*,min(r.published_at) over(partition by btrim(r.external_review_id)) as first_publication,
   row_number() over(partition by btrim(r.external_review_id) order by (public.review_usable_text(r.original_text,r.text) is not null) desc,r.updated_at desc,r.id) as duplicate_rank
  from public.reviews r where r.establishment_id=p_establishment
 ) select id from candidates where duplicate_rank=1
  and public.review_usable_text(original_text,text) is not null
  and first_publication>=public.recent_review_cutoff(p_as_of) and first_publication<=p_as_of
 order by first_publication desc,btrim(external_review_id) collate "C",id limit 100
$$;
create function public.review_corpus_fingerprint(p_establishment uuid) returns text
language sql stable set search_path='' as $$
 select encode(extensions.digest(coalesce(jsonb_agg(jsonb_build_object(
  'id',r.id,'published_at',r.published_at,'original_text',coalesce(nullif(r.original_text,''),r.text),
  'original_language',r.original_language,
  'english',(select translated_text from public.review_translations t where t.review_id=r.id and t.language='en'),
  'override',(select jsonb_build_object('text',o.corrected_english_text,'status',o.status,'original_sha',o.original_text_sha256,'provider_sha',o.provider_translation_sha256) from public.analysis_review_english_translation_overrides o where o.review_id=r.id)
 ) order by r.id),'[]')::text,'sha256'),'hex')
 from public.reviews r where r.establishment_id=p_establishment and r.id in(select public.retained_review_ids(p_establishment))
$$;

-- No credential, author, review text, question, answer or evidence is retained
-- in this ledger. Summary records are explicitly non-additive.
create function private.retention_number(j jsonb,k text) returns bigint language sql immutable set search_path='' as $$
 select case when j->>k ~ '^[0-9]+$' then (j->>k)::bigint end
$$;
create function private.record_retention_attempt(p_relation text,j jsonb) returns void
language plpgsql set search_path='' as $$
declare n integer;ph text;rec jsonb;u jsonb;key text;src jsonb;outcome text;scope text;begin
 n=coalesce(private.retention_number(j,'request_count'),private.retention_number(j,'ai_attempt_count'),private.retention_number(j,'provider_requests'),0)::integer;
 ph=coalesce(j->>'phase',case when p_relation='public.reviews' then 'review_ai' when p_relation like '%sync%' or p_relation like '%import%' then 'ingestion' else 'native' end);
 scope=case when p_relation like '%sync%' or p_relation like '%import%' then 'ingestion_summary_not_additive' else 'native_attempt' end;
 if private.retention_number(j,'sol_request_count')>0 then n=(j->>'sol_request_count')::int;ph='sol';end if;
 if p_relation='public.historical_report_runs' then
  if j#>>'{snapshot,analysis_version}' in('9','10','11') or exists(select 1 from public.report_generation_requests q where q.source_run_id=(j->>'id')::uuid and q.engine='jev_sol_v2') then return;end if;
  n=coalesce(private.retention_number(j,'ai_calls'),0)::int;ph='legacy_sol_summary';scope='legacy_summary_not_additive';
 end if;
 if n<=0 then return;end if;
 if p_relation='public.analysis_jev_batch_tasks' then
  j=j||jsonb_build_object('establishment_id',(select establishment_id from public.analysis_jev_batch_runs where id=(j->>'run_id')::uuid),'model','jev-1.13.0');
 end if;
 key=coalesce(j->>'id',j->>'task_id',j->>'run_id',encode(extensions.digest((j-'text'-'original_text'-'payload'-'request'-'result'-'body')::text,'sha256'),'hex'));
 rec=coalesce(j->'sol_receipt',j->'receipt',j->'response');
 if rec is null and p_relation='public.analysis_jls_restaurant_tasks' then
  begin select wire::jsonb||jsonb_build_object('receipt_sha256',outcome_sha256) into rec from public.analysis_jls_task_receipts where task_id=(j->>'id')::uuid limit 1;exception when others then rec=null;end;
 end if;
 u=coalesce(rec->'usage',j->'usage');
 if u is null and rec->>'raw_response_text' like '{%' then begin src=(rec->>'raw_response_text')::jsonb;u=src->'usage';exception when others then u=null;end;end if;
 outcome=case when j->>'status' in('completed','reused','success') then 'completed' when rec is not null then 'received' when j->>'status' in('failed','invalid_output') then 'failed' else 'unknown' end;
 insert into private.provider_attempt_ledger(source_relation,source_key,phase,organization_id,establishment_id,provider,model,attempts,outcome,request_sha256,receipt_sha256,provider_request_id,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,duration_ms,usage_complete,started_at,completed_at,accounting_scope)
 values(p_relation,key,ph,nullif(j->>'organization_id','')::uuid,nullif(j->>'establishment_id','')::uuid,
  coalesce(j->>'provider',case when ph='sol' or ph like '%sol%' then 'openai' when ph in('jev','native') then 'jev' end),
  coalesce(j->>'served_model',j->>'model',j->>'ai_model',rec->>'served_model',src->>'model'),n,outcome,
  coalesce(j->>'request_sha256',j->>'request_raw_sha256',rec->>'request_sha256'),coalesce(j->>'receipt_sha256',rec->>'receipt_sha256'),coalesce(j->>'provider_request_id',rec->>'provider_request_id'),
  coalesce(private.retention_number(j,'input_tokens'),private.retention_number(j,'ai_input_tokens'),private.retention_number(u,'input_tokens')),
  coalesce(private.retention_number(j,'output_tokens'),private.retention_number(j,'ai_output_tokens'),private.retention_number(u,'output_tokens')),
  coalesce(private.retention_number(u,'cache_read_input_tokens'),private.retention_number(u->'input_tokens_details','cached_tokens')),
  private.retention_number(u,'cache_creation_input_tokens'),coalesce(private.retention_number(j,'duration_ms'),private.retention_number(rec,'duration_ms')),
  coalesce(private.retention_number(j,'input_tokens'),private.retention_number(j,'ai_input_tokens'),private.retention_number(u,'input_tokens')) is not null,
  nullif(coalesce(j->>'reserved_at',j->>'dispatched_at',j->>'started_at'),'')::timestamptz,nullif(j->>'completed_at','')::timestamptz,scope)
 on conflict(source_relation,source_key,phase) do update set
  outcome=case when excluded.outcome='unknown' and provider_attempt_ledger.outcome<>'unknown' then provider_attempt_ledger.outcome else excluded.outcome end,
  receipt_sha256=coalesce(provider_attempt_ledger.receipt_sha256,excluded.receipt_sha256),provider_request_id=coalesce(provider_attempt_ledger.provider_request_id,excluded.provider_request_id),
  input_tokens=coalesce(provider_attempt_ledger.input_tokens,excluded.input_tokens),output_tokens=coalesce(provider_attempt_ledger.output_tokens,excluded.output_tokens),
  cache_read_tokens=coalesce(provider_attempt_ledger.cache_read_tokens,excluded.cache_read_tokens),cache_write_tokens=coalesce(provider_attempt_ledger.cache_write_tokens,excluded.cache_write_tokens),
  duration_ms=coalesce(provider_attempt_ledger.duration_ms,excluded.duration_ms),usage_complete=provider_attempt_ledger.usage_complete or excluded.usage_complete,
  completed_at=coalesce(provider_attempt_ledger.completed_at,excluded.completed_at);
end $$;

create function private.capture_retention_attempt_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.record_retention_attempt(tg_table_schema||'.'||tg_table_name,to_jsonb(new));return new;end $$;

create function private.retention_retire_source(p_source uuid,p_reason text) returns boolean
language plpgsql security definer set search_path='' as $$
declare s public.historical_report_runs;b public.analysis_jev_batch_runs;sc public.report_corpus_scopes;r public.analysis_parallel_reports;t text;prior text;begin
 perform pg_advisory_xact_lock(hashtextextended('retention-source-cleanup',0));
 select * into s from public.historical_report_runs where id=p_source;
 if s.id is null then return true;end if;
 select * into b from public.analysis_jev_batch_runs where current_source_run_id=p_source;
 if b.id is not null and (exists(select 1 from public.analysis_jev_batch_tasks where run_id=b.id and status='reserved' and lease_until>now()) or b.sol_request_count=1 and b.sol_receipt is null and b.sol_lease_until>now()) then
  update public.analysis_jev_batch_runs set armed=false where id=b.id;
  update public.report_corpus_scopes set stale=true,stale_reason=p_reason where source_run_id=p_source;
  return false;
 end if;
 select * into sc from public.report_corpus_scopes where source_run_id=p_source;
 select * into r from public.analysis_parallel_reports where current_source_run_id=p_source;
 if sc.source_run_id is not null then insert into private.retired_report_scopes(establishment_id,language,organization_id,report_id,source_run_id,generated_at,review_count,period_start,period_end,reason)
  values(s.establishment_id,s.language,s.organization_id,r.id,s.id,r.generated_at,sc.review_count,sc.period_start,sc.period_end,p_reason)
  on conflict(establishment_id,language) do update set report_id=excluded.report_id,source_run_id=excluded.source_run_id,generated_at=excluded.generated_at,review_count=excluded.review_count,period_start=excluded.period_start,period_end=excluded.period_end,retired_at=now(),reason=excluded.reason;end if;
 perform private.record_retention_attempt('public.analysis_jev_batch_runs',to_jsonb(b));
 perform private.record_retention_attempt('public.analysis_jev_batch_tasks',to_jsonb(x)) from public.analysis_jev_batch_tasks x where run_id=b.id;
 insert into private.retired_generation_keys select id,source_run_id,now(),(select epoch from public.review_corpus_policy) from public.report_generation_requests where source_run_id=p_source on conflict do nothing;
 prior=current_setting('home.retention_maintenance',true);perform set_config('home.retention_maintenance','on',true);
 -- Explicit reviewed current-pipeline tables only. FK constraints remain on.
 foreach t in array array['public.report_generation_abandonments','public.report_generation_requests','public.analysis_jev_batch_tasks','public.analysis_jev_batch_runs','public.analysis_parallel_reports','public.analysis_parallel_launch_preparations','public.historical_report_runs'] loop execute format('alter table %s disable trigger user',t);end loop;
 delete from public.report_corpus_scopes where source_run_id=p_source;
 delete from public.report_generation_abandonments where source_run_id=p_source;
 delete from public.report_generation_requests where source_run_id=p_source;
 delete from public.analysis_jev_batch_tasks where run_id=b.id;
 delete from public.analysis_jev_batch_runs where id=b.id;
 delete from public.analysis_parallel_reports where current_source_run_id=p_source;
 delete from public.analysis_parallel_launch_preparations where current_source_run_id=p_source;
 delete from public.historical_report_runs where id=p_source;
 foreach t in array array['public.report_generation_abandonments','public.report_generation_requests','public.analysis_jev_batch_tasks','public.analysis_jev_batch_runs','public.analysis_parallel_reports','public.analysis_parallel_launch_preparations','public.historical_report_runs'] loop execute format('alter table %s enable trigger user',t);end loop;
 perform set_config('home.retention_maintenance',coalesce(prior,''),true);return true;
end $$;

create function private.apply_recent_review_retention(p_establishment uuid,p_as_of timestamptz default now()) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.review_corpus_policy;e public.establishments;keep uuid[];excluded uuid[];before_n integer;after_n integer;f text;prior text;s record;begin
 select * into p from public.review_corpus_policy where id for share;
 if not p.enabled then return jsonb_build_object('enabled',false);end if;
 select * into e from public.establishments where id=p_establishment;
 if e.id is null then raise exception 'ESTABLISHMENT_NOT_FOUND';end if;
 if current_setting('role',true)='authenticated' and not exists(select 1 from public.organization_members where organization_id=e.organization_id and user_id=(select auth.uid())) then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||p_establishment::text,0));
 select coalesce(array_agg(id),'{}') into keep from public.retained_review_ids(p_establishment,p_as_of) id;
 select count(*),coalesce(array_agg(id) filter(where not(id=any(keep))),'{}') into before_n,excluded from public.reviews where establishment_id=p_establishment;
 prior=current_setting('home.retention_maintenance',true);perform set_config('home.retention_maintenance','on',true);
 for s in select source_run_id from public.report_corpus_scopes where establishment_id=p_establishment and not(review_ids<@keep) loop perform private.retention_retire_source(s.source_run_id,'CORPUS_REVIEW_REMOVED');end loop;
 -- All other review FK dependents were retired during the explicit cutover.
 -- These are the ongoing, review-scoped dependencies inspected before deletion.
 delete from public.analysis_review_english_translation_overrides where review_id=any(excluded);
 delete from public.notifications where review_id=any(excluded);
 delete from public.push_test_deliveries where review_id=any(excluded);
 delete from public.review_reply_drafts where review_id=any(excluded);
 delete from public.review_translations where review_id=any(excluded);
 delete from public.review_provider_payloads where review_id=any(excluded);
 delete from public.reviews where id=any(excluded);
 select count(*) into after_n from public.reviews where establishment_id=p_establishment;
 f=public.review_corpus_fingerprint(p_establishment);
 insert into public.review_corpus_states(establishment_id,organization_id,policy_epoch,checked_at,retained_count,period_start,period_end,fingerprint)
 select e.id,e.organization_id,p.epoch,p_as_of,after_n,min(published_at),max(published_at),f from public.reviews where establishment_id=p_establishment
 on conflict(establishment_id) do update set policy_epoch=excluded.policy_epoch,checked_at=excluded.checked_at,retained_count=excluded.retained_count,period_start=excluded.period_start,period_end=excluded.period_end,fingerprint=excluded.fingerprint,changed_at=case when review_corpus_states.fingerprint<>excluded.fingerprint then now() else review_corpus_states.changed_at end;
 update public.report_corpus_scopes set stale=fingerprint<>f,stale_reason=case when fingerprint<>f then 'CORPUS_CHANGED' end where establishment_id=p_establishment;
 if before_n<>after_n then insert into public.review_retention_events(organization_id,establishment_id,policy_epoch,as_of,cutoff,before_count,after_count,purged_count) values(e.organization_id,e.id,p.epoch,p_as_of,public.recent_review_cutoff(p_as_of),before_n,after_n,before_n-after_n);end if;
 perform set_config('home.retention_maintenance',coalesce(prior,''),true);
 return jsonb_build_object('establishment_id',e.id,'retained',after_n,'purged',before_n-after_n,'fingerprint',f);
end $$;
create function public.apply_recent_review_retention(p_establishment uuid,p_as_of timestamptz default now()) returns jsonb
language sql set search_path='' as $$select private.apply_recent_review_retention(p_establishment,p_as_of)$$;

create function private.retention_review_admission() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.review_corpus_policy;seen private.review_seen_keys;sha text;first_seen boolean;oldest public.reviews;valid_n integer;begin
 if current_user in('postgres','supabase_admin') and current_setting('home.retention_maintenance',true)='on' then return new;end if;
 select * into p from public.review_corpus_policy where id for share;
 if not p.enabled then return new;end if;
 if p.paused or p.ingestions_paused then raise exception 'RETENTION_INGESTION_PAUSED';end if;
 if not exists(select 1 from public.establishments where id=new.establishment_id and organization_id=new.organization_id)
 or current_setting('role',true)='authenticated' and not exists(select 1 from public.organization_members where organization_id=new.organization_id and user_id=(select auth.uid())) then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||new.establishment_id::text,0));
 if tg_op='UPDATE' then
  if new.establishment_id<>old.establishment_id or new.organization_id<>old.organization_id or btrim(new.external_review_id)<>btrim(old.external_review_id) then raise exception 'REVIEW_IDENTITY_IMMUTABLE';end if;
  new.published_at=least(old.published_at,new.published_at);
 end if;
 new.external_review_id=btrim(new.external_review_id);
 if nullif(btrim(new.original_text),'') is null and nullif(btrim(new.text),'') is not null then new.original_text=new.text;end if;
 sha=encode(extensions.digest(new.external_review_id,'sha256'),'hex');
 select * into seen from private.review_seen_keys where establishment_id=new.establishment_id and external_key_sha256=sha;
 first_seen=seen.establishment_id is null;
 new.published_at=least(new.published_at,seen.first_published_at);
 insert into private.review_seen_keys(establishment_id,external_key_sha256,first_published_at) values(new.establishment_id,sha,new.published_at)
 on conflict(establishment_id,external_key_sha256) do update set first_published_at=least(review_seen_keys.first_published_at,excluded.first_published_at);
 if first_seen then
  insert into public.review_observation_totals(establishment_id,organization_id,observed_reviews,observed_textless_reviews,textless_star_counts)
  values(new.establishment_id,new.organization_id,1,case when public.review_usable_text(new.original_text,new.text) is null then 1 else 0 end,
   case when public.review_usable_text(new.original_text,new.text) is null then jsonb_set('{"1":0,"2":0,"3":0,"4":0,"5":0}',array[new.rating::text],'1') else '{"1":0,"2":0,"3":0,"4":0,"5":0}' end)
  on conflict(establishment_id) do update set observed_reviews=review_observation_totals.observed_reviews+1,observed_textless_reviews=review_observation_totals.observed_textless_reviews+excluded.observed_textless_reviews,
   textless_star_counts=case when excluded.observed_textless_reviews=1 then jsonb_set(review_observation_totals.textless_star_counts,array[new.rating::text],to_jsonb(coalesce((review_observation_totals.textless_star_counts->>new.rating::text)::bigint,0)+1)) else review_observation_totals.textless_star_counts end,updated_at=now();
 end if;
 if tg_op='UPDATE' or exists(select 1 from public.reviews where establishment_id=new.establishment_id and external_review_id=new.external_review_id) then return new;end if;
 if public.review_usable_text(new.original_text,new.text) is null or new.published_at is null or new.published_at<public.recent_review_cutoff(now()) or new.published_at>now() then return null;end if;
 select count(*) into valid_n from public.retained_review_ids(new.establishment_id);
 if valid_n>=100 then
  select r.* into oldest from public.reviews r where id in(select public.retained_review_ids(new.establishment_id)) order by published_at,external_review_id collate "C" desc,id desc limit 1;
  if new.published_at<oldest.published_at or new.published_at=oldest.published_at and new.external_review_id collate "C">=oldest.external_review_id collate "C" then return null;end if;
 end if;
 return new;
end $$;
create function private.retention_review_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if current_setting('home.retention_maintenance',true)='on' or current_setting('home.retention_ingest',true)='on' then return null;end if;
 perform private.apply_recent_review_retention(case when tg_op='DELETE' then old.establishment_id else new.establishment_id end);return null;
end $$;
create trigger recent_text_admission before insert or update on public.reviews for each row execute function private.retention_review_admission();
create trigger recent_text_refresh after insert or update or delete on public.reviews for each row execute function private.retention_review_changed();

-- Public SQL helpers do not confer cross-organization read access. Only the
-- server may invoke corpus maintenance or read hashed ingestion tombstones.
revoke all on function public.retained_review_ids(uuid,timestamptz),public.review_corpus_fingerprint(uuid),public.apply_recent_review_retention(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.retained_review_ids(uuid,timestamptz),public.review_corpus_fingerprint(uuid),public.apply_recent_review_retention(uuid,timestamptz) to service_role;
revoke all on function private.record_retention_attempt(text,jsonb),private.capture_retention_attempt_trigger(),private.retention_retire_source(uuid,text),private.apply_recent_review_retention(uuid,timestamptz),private.retention_review_admission(),private.retention_review_changed(),private.retention_number(jsonb,text) from public,anon,authenticated;
grant execute on function private.apply_recent_review_retention(uuid,timestamptz) to service_role;

create function public.freeze_recent_review_source(p_establishment uuid,p_organization uuid,p_language text,p_as_of timestamptz) returns jsonb
language plpgsql set search_path='' as $$
declare p public.review_corpus_policy;rows jsonb;overrides jsonb;meta jsonb;e jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.review_corpus_policy where id for share;
 if p.paused or not p.enabled then raise exception 'RETENTION_TRANSITION_ACTIVE';end if;
 perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||p_establishment::text,0));
 perform private.apply_recent_review_retention(p_establishment,p_as_of);
 select jsonb_build_object('id',id,'organization_id',organization_id,'name',name,'rating',rating,'total_reviews',total_reviews,'created_at',created_at) into e from public.establishments where id=p_establishment and organization_id=p_organization;
 if e is null then raise exception 'FORBIDDEN';end if;
 select jsonb_agg(jsonb_build_object('id',r.id,'rating',r.rating,'original_text',coalesce(nullif(r.original_text,''),r.text),'original_language',r.original_language,'text',r.text,'published_at',r.published_at,
  'historical_import',r.historical_import,'has_negative_feedback',r.has_negative_feedback,'status',r.status,'review_detailed_rating',r.review_detailed_rating,'review_context',r.review_context,
  'ai_status',r.ai_status,'ai_suggested_reply',r.ai_suggested_reply,'ai_suggested_reply_language',r.ai_suggested_reply_language,'reply_draft_text',r.reply_draft_text,'reply_draft_language',r.reply_draft_language,
  'review_translations',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'language',t.language,'translated_text',t.translated_text,'created_at',t.created_at,'updated_at',t.updated_at) order by t.language) from public.review_translations t where t.review_id=r.id),'[]'),
  'review_reply_drafts',coalesce((select jsonb_agg(jsonb_build_object('language',d.language,'ai_status',d.ai_status,'draft_text',d.draft_text,'ai_suggested_reply',d.ai_suggested_reply)) from public.review_reply_drafts d where d.review_id=r.id),'[]')) order by r.id),
  jsonb_build_object('epoch',p.epoch,'version',p.version,'as_of',p_as_of,'cutoff',public.recent_review_cutoff(p_as_of),'review_count',count(*),'period_start',min(r.published_at),'period_end',max(r.published_at),
   'review_ids',jsonb_agg(r.id order by r.id),'fingerprint',public.review_corpus_fingerprint(p_establishment)) into rows,meta
 from public.reviews r where r.establishment_id=p_establishment and r.id in(select public.retained_review_ids(p_establishment,p_as_of));
 if rows is null then raise exception 'NO_RECENT_TEXT_REVIEWS';end if;
 select coalesce(jsonb_agg(to_jsonb(o)),'[]') into overrides from public.analysis_review_english_translation_overrides o where o.review_id in(select public.retained_review_ids(p_establishment,p_as_of));
 return jsonb_build_object('analysis_version',8,'english_translation_override_policy','verified_english_translation_overrides_v1','retention',meta,'retention_frozen_rows',rows,'retention_english_overrides',overrides,'retention_establishment',e);
end $$;
create function private.retention_bind_scope() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.historical_report_runs;m jsonb;p public.review_corpus_policy;begin
 select * into p from public.review_corpus_policy where id for share;
 if p.paused then raise exception 'RETENTION_TRANSITION_ACTIVE';end if;
 if not p.enabled then return new;end if;
 if new.engine<>'jev_sol_v2' or new.jev_transport<>'batch_initial_v1' then raise exception 'RETAINED_BATCH_PIPELINE_REQUIRED';end if;
 select * into r from public.historical_report_runs where id=new.source_run_id;m=r.snapshot->'retention';
 if m is null or m->>'epoch'<>p.epoch::text then raise exception 'FROZEN_RECENT_CORPUS_REQUIRED';end if;
 insert into public.report_corpus_scopes(source_run_id,organization_id,establishment_id,policy_epoch,as_of,cutoff,review_ids,review_count,period_start,period_end,fingerprint)
 values(r.id,r.organization_id,r.establishment_id,p.epoch,(m->>'as_of')::timestamptz,(m->>'cutoff')::timestamptz,
  array(select x::uuid from jsonb_array_elements_text(m->'review_ids') x),(m->>'review_count')::int,(m->>'period_start')::timestamptz,(m->>'period_end')::timestamptz,m->>'fingerprint');return new;
end $$;
create trigger recent_text_bind_scope after insert on public.report_generation_requests for each row execute function private.retention_bind_scope();

-- Keep the original enqueue idempotency/unknown-outcome guards. Only the fresh
-- source is now frozen atomically under the same establishment lock as ingestion.
do $$declare d text;a text;begin
 d=pg_get_functiondef('public.enqueue_current_report(uuid,uuid,uuid,text,uuid,text,integer)'::regprocedure);
 a='declare r public.historical_report_runs;q public.report_generation_requests;e text;jt text;begin';
 if position(a in d)=0 then raise exception 'RETENTION_ENQUEUE_DECLARATION_CHANGED';end if;
 d=replace(d,a,a||E'\n if exists(select 1 from private.retired_generation_keys where request_id=p_request) then raise exception ''REPORT_REQUEST_RETIRED'';end if;\n if exists(select 1 from public.review_corpus_policy where paused) then raise exception ''RETENTION_TRANSITION_ACTIVE'';end if;\n if exists(select 1 from public.review_corpus_policy where enabled) then perform pg_advisory_xact_lock(hashtextextended(''recent-text-corpus:''||p_establishment::text,0));end if;');
 a='''{"analysis_version":8,"english_translation_override_policy":"verified_english_translation_overrides_v1"}''';
 if position(a in d)=0 then raise exception 'RETENTION_ENQUEUE_SNAPSHOT_CHANGED';end if;
 d=replace(d,a,'case when exists(select 1 from public.review_corpus_policy where enabled) then public.freeze_recent_review_source(p_establishment,p_organization,p_language,now()) else '||a||'::jsonb end');
 execute d;
end $$;

create function public.retention_batch_allowed(p_run uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare p public.review_corpus_policy;b public.analysis_jev_batch_runs;sc public.report_corpus_scopes;begin
 select * into p from public.review_corpus_policy where id for share;
 if p.paused then return false;end if;
 if not p.enabled then return true;end if;
 select * into b from public.analysis_jev_batch_runs where id=p_run;
 if b.id is null or b.current_source_run_id is null then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||b.establishment_id::text,0));
 select * into sc from public.report_corpus_scopes where source_run_id=b.current_source_run_id;
 if sc.source_run_id is null or sc.policy_epoch<>p.epoch or sc.stale or sc.fingerprint<>public.review_corpus_fingerprint(b.establishment_id) then
  update public.analysis_jev_batch_runs set armed=false,status='blocked',error_code='CORPUS_CHANGED_DURING_GENERATION' where id=b.id;
  return false;
 end if;
 if exists(select 1 from public.analysis_jev_batch_tasks t join private.provider_attempt_ledger l on l.request_sha256=t.request_sha256 and l.outcome='unknown' and l.provider='jev' where t.run_id=b.id and t.status='pending' and t.request_count=0) then
  update public.analysis_jev_batch_runs set armed=false,status='blocked',error_code='PREVIOUS_IDENTICAL_REQUEST_OUTCOME_UNKNOWN' where id=b.id;return false;
 end if;
 return true;
end $$;
do $$declare d text;a text;item record;begin
 for item in select oid,proname,pg_get_function_identity_arguments(oid) args from pg_proc where pronamespace='public'::regnamespace and proname in('jev_batch_claim','jev_batch_claim_sol') loop
  d=pg_get_functiondef(item.oid);a=substring(d from 'begin');
  if a is null then raise exception 'RETENTION_BATCH_CLAIM_CHANGED';end if;
  d=overlay(d placing 'begin'||case when item.proname='jev_batch_claim' then ' if not public.retention_batch_allowed(p_run) then return null;end if;' else ' if not public.retention_batch_allowed(p_run) then return false;end if;' end from position(a in d) for 5);execute d;
 end loop;
end $$;
create function private.retention_publication_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.review_corpus_policy;sc public.report_corpus_scopes;begin
 if current_setting('home.retention_maintenance',true)='on' then return new;end if;
 select * into p from public.review_corpus_policy where id for share;
 if not p.enabled then return new;end if;
 select * into sc from public.report_corpus_scopes where source_run_id=new.current_source_run_id;
 if sc.source_run_id is null or sc.policy_epoch<>p.epoch then raise exception 'RETAINED_CURRENT_SOURCE_REQUIRED';end if;
 if new.state in('completed','needs_review') and (sc.stale or sc.fingerprint<>public.review_corpus_fingerprint(new.establishment_id)) then
  new.state='blocked';new.error_code='CORPUS_CHANGED_DURING_GENERATION';new.derived_report=null;
 end if;return new;
end $$;
create trigger recent_text_publication before insert or update on public.analysis_parallel_reports for each row execute function private.retention_publication_guard();

create function public.known_retention_review_ids(p_establishment uuid,p_external_ids text[]) returns setof text language sql stable set search_path='' as $$
 select x from unnest(p_external_ids) x where exists(select 1 from private.review_seen_keys s where s.establishment_id=p_establishment and s.external_key_sha256=encode(extensions.digest(btrim(x),'sha256'),'hex'))
$$;
revoke all on function public.freeze_recent_review_source(uuid,uuid,text,timestamptz),public.retention_batch_allowed(uuid),public.known_retention_review_ids(uuid,text[]) from public,anon,authenticated;
grant execute on function public.freeze_recent_review_source(uuid,uuid,text,timestamptz),public.retention_batch_allowed(uuid),public.known_retention_review_ids(uuid,text[]) to service_role;
revoke all on function private.retention_bind_scope(),private.retention_publication_guard() from public,anon,authenticated;

create function public.ingest_recent_reviews(p_establishment uuid,p_organization uuid,p_bundle jsonb,p_provider text) returns jsonb
language plpgsql set search_path='' as $$
declare p public.review_corpus_policy;b jsonb;v public.reviews;rid uuid;inserted_ids uuid[]='{}';i integer;prior text;tr jsonb;begin
 if current_user<>'service_role' or jsonb_typeof(p_bundle)<>'array' or jsonb_array_length(p_bundle)>500 then raise exception 'FORBIDDEN';end if;
 select * into p from public.review_corpus_policy where id for share;
 if p.paused or p.ingestions_paused or not p.enabled then raise exception 'RETENTION_INGESTION_PAUSED';end if;
 if not exists(select 1 from public.establishments where id=p_establishment and organization_id=p_organization) then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||p_establishment::text,0));
 prior=current_setting('home.retention_ingest',true);perform set_config('home.retention_ingest','on',true);
 for b in with items as(select value,ordinality from jsonb_array_elements(p_bundle) with ordinality), ranked as(
  select value, row_number() over(partition by btrim(value#>>'{row,external_review_id}') order by ordinality desc) rn,
   min(nullif(value#>>'{row,published_at}','')::timestamptz) over(partition by btrim(value#>>'{row,external_review_id}')) first_date from items)
  select jsonb_set(value,'{row,published_at}',coalesce(to_jsonb(first_date),'null')) from ranked where rn=1 loop
  v=jsonb_populate_record(null::public.reviews,b->'row');
  if v.organization_id<>p_organization or v.establishment_id<>p_establishment or v.rating not between 1 and 5 or nullif(btrim(v.external_review_id),'') is null then raise exception 'INGESTION_SCOPE_INVALID';end if;
  v.external_review_id=btrim(v.external_review_id);rid=null;
  update public.reviews set "author_name"=v."author_name","author_image"=v."author_image","rating"=v."rating","text"=v."text","original_text"=v."original_text","original_language"=v."original_language","language"=v."language","published_at"=v."published_at","review_url"=v."review_url","owner_response"=v."owner_response","source_provider"=v."source_provider","provider_publish_at"=v."provider_publish_at","provider_rating"=v."provider_rating","likes_count"=v."likes_count","review_context"=v."review_context","review_detailed_rating"=v."review_detailed_rating","visited_in"=v."visited_in","review_image_urls"=v."review_image_urls","response_from_owner_text"=v."response_from_owner_text","response_from_owner_date"=v."response_from_owner_date","reviewer_id"=v."reviewer_id","reviewer_url"=v."reviewer_url","reviewer_number_of_reviews"=v."reviewer_number_of_reviews","reviewer_photo_url"=v."reviewer_photo_url","is_local_guide"=v."is_local_guide","review_origin"=v."review_origin","provider_scraped_at"=v."provider_scraped_at" where establishment_id=p_establishment and external_review_id=v.external_review_id returning id into rid;
  if rid is null then
   insert into public.reviews("organization_id","establishment_id","external_review_id","author_name","author_image","rating","text","original_text","original_language","language","published_at","review_url","owner_response","source_provider","provider_publish_at","provider_rating","likes_count","review_context","review_detailed_rating","visited_in","review_image_urls","response_from_owner_text","response_from_owner_date","reviewer_id","reviewer_url","reviewer_number_of_reviews","reviewer_photo_url","is_local_guide","review_origin","provider_scraped_at","historical_import","requires_attention","requires_ai_analysis","status") select v."organization_id",v."establishment_id",v."external_review_id",v."author_name",v."author_image",v."rating",v."text",v."original_text",v."original_language",v."language",v."published_at",v."review_url",v."owner_response",v."source_provider",v."provider_publish_at",v."provider_rating",v."likes_count",v."review_context",v."review_detailed_rating",v."visited_in",v."review_image_urls",v."response_from_owner_text",v."response_from_owner_date",v."reviewer_id",v."reviewer_url",v."reviewer_number_of_reviews",v."reviewer_photo_url",v."is_local_guide",v."review_origin",v."provider_scraped_at",v."historical_import",v."requires_attention",v."requires_ai_analysis",v."status" returning id into rid;
   if rid is not null then inserted_ids=array_append(inserted_ids,rid);end if;
  end if;
  if rid is not null then
   for tr in select value from jsonb_array_elements(coalesce(b->'translations','[]')) loop
    if nullif(btrim(tr->>'translated_text'),'') is not null and tr->>'language' in('en','fr','vi') then
     insert into public.review_translations(review_id,language,translated_text) values(rid,tr->>'language',tr->>'translated_text')
     on conflict(review_id,language) do update set translated_text=excluded.translated_text,updated_at=now();
    end if;
   end loop;
   insert into public.review_provider_payloads(review_id,provider,raw_payload,provider_last_seen_at) values(rid,p_provider,coalesce(b->'raw_payload','{}'),now())
   on conflict(review_id,provider) do update set raw_payload=excluded.raw_payload,provider_last_seen_at=now(),updated_at=now();
  end if;
 end loop;
 perform private.apply_recent_review_retention(p_establishment);
 perform set_config('home.retention_ingest',coalesce(prior,''),true);
 select count(*) into i from public.reviews where id=any(inserted_ids);
 return jsonb_build_object('inserted',i,'retained',(select count(*) from public.reviews where establishment_id=p_establishment));
end $$;
revoke all on function public.ingest_recent_reviews(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.ingest_recent_reviews(uuid,uuid,jsonb,text) to service_role;

create function private.retention_sanitize_snapshot() returns trigger language plpgsql set search_path='' as $$
begin if exists(select 1 from public.review_corpus_policy where enabled) then new.raw_place_payload='{}';end if;return new;end $$;
create trigger recent_text_snapshot_summary before insert or update on public.establishment_snapshots for each row execute function private.retention_sanitize_snapshot();
revoke all on function private.retention_sanitize_snapshot() from public,anon,authenticated;

create function public.maintain_recent_review_corpora() returns jsonb language plpgsql security definer set search_path='' as $$
declare e record;s record;n integer=0;begin
 if not exists(select 1 from public.review_corpus_policy where enabled and not paused) then return jsonb_build_object('paused',true);end if;
 for e in select id from public.establishments order by id loop perform private.apply_recent_review_retention(e.id);n=n+1;end loop;
 -- Keep only the most recent available report. Consumed attempts are copied to
 -- the text-free ledger before retiring any previous report.
 for s in select old.current_source_run_id from public.analysis_parallel_reports old
  where old.current_source_run_id is not null and old.state in('completed','needs_review')
   and exists(select 1 from public.analysis_parallel_reports newer where newer.establishment_id=old.establishment_id and newer.language=old.language and newer.state in('completed','needs_review') and (newer.generated_at,newer.id)>(old.generated_at,old.id))
 loop perform private.retention_retire_source(s.current_source_run_id,'SUPERSEDED_REPORT');end loop;
 delete from public.review_retention_events where created_at<now()-interval '90 days';
 return jsonb_build_object('establishments_checked',n);
end $$;
revoke all on function public.maintain_recent_review_corpora() from public,anon,authenticated;
grant execute on function public.maintain_recent_review_corpora() to service_role;

-- Native bookkeeping follows receipt commits, including errors and unknown
-- outcomes. This adds no request, retry, threshold or response conversion.
create trigger recent_text_jev_attempt after insert or update on public.analysis_jev_batch_tasks for each row execute function private.capture_retention_attempt_trigger();
create trigger recent_text_sol_attempt after insert or update on public.analysis_jev_batch_runs for each row execute function private.capture_retention_attempt_trigger();

create function public.read_retired_report_scope(p_establishment uuid,p_organization uuid,p_language text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' then raise exception 'FORBIDDEN';end if;
 return (select jsonb_build_object('generated_at',generated_at,'period_start',period_start,'period_end',period_end,'review_count',review_count,'reason',reason) from private.retired_report_scopes where establishment_id=p_establishment and organization_id=p_organization and language=p_language);
end $$;
revoke all on function public.read_retired_report_scope(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.read_retired_report_scope(uuid,uuid,text) to service_role;


