-- Same batch queue, account slot and native receipts for automatic and manual
-- consumers. No work/backfill is enqueued by installation.
begin;
set local lock_timeout='5s';
create table private.shared_jev_runtime(singleton boolean primary key default true check(singleton),enabled boolean not null default false,activated_at timestamptz,reason text);
insert into private.shared_jev_runtime(singleton,enabled) values(true,false);
alter table private.shared_jev_runtime enable row level security;
revoke all on private.shared_jev_runtime from public,anon,authenticated;
grant select,update on private.shared_jev_runtime to service_role;
alter table public.report_generation_requests add column shared_jev_version text;
alter table public.report_corpus_scopes add column frozen_until timestamptz;
alter table public.analysis_jev_batch_runs add column purpose text not null default 'report'
 check(purpose in('report','new_reviews'));
alter table public.analysis_jev_batch_runs add column shared_jev_version text;
alter table public.analysis_jev_batch_runs add column policy_epoch uuid;
alter table public.analysis_jev_batch_runs add column sync_job_id uuid;
create unique index shared_jev_sync_once on public.analysis_jev_batch_runs(sync_job_id) where sync_job_id is not null;
alter table public.analysis_jev_batch_runs alter column report_id drop not null;
alter table public.analysis_jev_batch_runs drop constraint batch_origin;
alter table public.analysis_jev_batch_runs add constraint batch_origin check(
 (purpose='report' and report_id is not null and ((baseline_report_id is not null and current_source_run_id is null) or (baseline_report_id is null and current_source_run_id is not null)))
 or (purpose='new_reviews' and baseline_report_id is null and current_source_run_id is null and report_id is null and sync_job_id is not null
 and sol_request_count=0 and sol_receipt is null and envelope is null and draft is null and shared_jev_version='shared-jev-initial-v1'));

create table private.shared_jev_analyses(
 identity_sha256 text primary key check(identity_sha256 ~ '^[a-f0-9]{64}$'),
 organization_id uuid not null references public.organizations(id),
 establishment_id uuid not null references public.establishments(id) on delete cascade,
 google_review_id text not null,
 identity jsonb not null check(public.jls_restaurant_hash(identity)=identity_sha256),
 owner_consumer uuid not null,task_id uuid,source_review_id uuid,
 state text not null default 'pending' check(state in('pending','ready','unknown','failed','expired')),
 result jsonb,result_sha256 text,receipt_sha256 text,request_sha256 text,question_keys jsonb,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check((state='ready')=(result is not null)),check(result is null or public.jls_restaurant_hash(result)=result_sha256)
);
create index shared_jev_by_establishment on private.shared_jev_analyses(establishment_id,google_review_id);
create index shared_jev_by_task on private.shared_jev_analyses(task_id) where task_id is not null;
create table private.shared_jev_consumers(
 consumer_id uuid not null,review_id uuid not null,identity_sha256 text not null references private.shared_jev_analyses(identity_sha256) on delete cascade,
 expires_at timestamptz not null,primary key(consumer_id,review_id),unique(consumer_id,identity_sha256)
);
create index shared_jev_consumers_identity on private.shared_jev_consumers(identity_sha256);
alter table private.shared_jev_analyses enable row level security;
alter table private.shared_jev_consumers enable row level security;
revoke all on private.shared_jev_analyses,private.shared_jev_consumers from public,anon,authenticated;
grant all on private.shared_jev_analyses,private.shared_jev_consumers to service_role;

-- Pin only future batch requests. Existing requests are intentionally unchanged.
create function private.pin_shared_jev_request() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_when='BEFORE' then
  new.shared_jev_version=case when new.engine='jev_sol_v2' and new.jev_transport='batch_initial_v1' and exists(select 1 from private.shared_jev_runtime where enabled) then 'shared-jev-initial-v1' end;
 else
  if new.shared_jev_version is not null then update public.report_corpus_scopes set frozen_until=s.created_at+interval '24 hours'
   from public.historical_report_runs s where s.id=new.source_run_id and source_run_id=s.id;end if;
 end if;return new;
end $$;
create trigger pin_shared_jev_before before insert on public.report_generation_requests for each row execute function private.pin_shared_jev_request();
create trigger pin_shared_jev_after after insert on public.report_generation_requests for each row execute function private.pin_shared_jev_request();
revoke all on function private.pin_shared_jev_request() from public,anon,authenticated;

-- Bounded frozen generation: live rotation is allowed, epoch/reset/reload is not.
create function private.shared_jev_frozen_allowed(p_source uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.report_corpus_scopes sc join public.historical_report_runs s on s.id=sc.source_run_id
 join public.report_generation_requests q on q.source_run_id=s.id join public.review_corpus_policy p on p.id
 join public.establishments e on e.id=s.establishment_id and e.organization_id=s.organization_id
 where s.id=p_source and q.shared_jev_version='shared-jev-initial-v1' and sc.frozen_until>clock_timestamp()
 and sc.policy_epoch=p.epoch and p.enabled and not p.paused and e.active
 and (e.review_reload_barrier_at is null or s.created_at>=e.review_reload_barrier_at)
 and not exists(select 1 from public.report_generation_abandonments a where a.source_run_id=s.id))
$$;
revoke all on function private.shared_jev_frozen_allowed(uuid) from public,anon,authenticated;
grant execute on function private.shared_jev_frozen_allowed(uuid) to service_role;

-- Resolve a consumer from server-frozen data, never a caller-supplied corpus.
create function private.shared_jev_source(p_consumer uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.analysis_jev_batch_runs;s public.historical_report_runs;c public.analysis_parallel_launch_preparations;begin
 select * into b from public.analysis_jev_batch_runs where id=p_consumer and purpose='new_reviews' and shared_jev_version='shared-jev-initial-v1';
 if b.id is not null then
  if not b.armed or b.status<>'running' or b.expires_at<=clock_timestamp() or not exists(select 1 from public.review_corpus_policy where epoch=b.policy_epoch and enabled and not paused)
   or not exists(select 1 from public.establishments where id=b.establishment_id and organization_id=b.organization_id and active and (review_reload_barrier_at is null or b.created_at>=review_reload_barrier_at)) then raise exception 'SHARED_JEV_CONSUMER_OBSOLETE';end if;
  return jsonb_build_object('organization_id',b.organization_id,'establishment_id',b.establishment_id,'expires_at',b.expires_at,'snapshot',b.snapshot);
 end if;
 select * into s from public.historical_report_runs where id=p_consumer and status in('queued','running','retry');
 if s.id is null or not private.shared_jev_frozen_allowed(s.id) then raise exception 'SHARED_JEV_CONSUMER_OBSOLETE';end if;
 select * into c from public.analysis_parallel_launch_preparations where current_source_run_id=s.id;
 if c.id is null then raise exception 'SHARED_JEV_CERTIFICATE_REQUIRED';end if;
 return jsonb_build_object('organization_id',s.organization_id,'establishment_id',s.establishment_id,'expires_at',s.created_at+interval '24 hours','snapshot',c.body->'source_snapshot');
end $$;
revoke all on function private.shared_jev_source(uuid) from public,anon,authenticated;
grant execute on function private.shared_jev_source(uuid) to service_role;

create function public.jev_shared_read(p_consumer uuid) returns jsonb language plpgsql set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('review_id',c.review_id,'identity',jsonb_build_object('review_id',c.review_id,'body',a.identity,'sha256',a.identity_sha256),
  'state',a.state,'owned',a.owner_consumer=p_consumer,'task_id',a.task_id,'source_review_id',a.source_review_id,
  'result',a.result,'result_sha256',a.result_sha256,'receipt_sha256',a.receipt_sha256,'question_keys',a.question_keys,'request_sha256',a.request_sha256) order by c.review_id),'[]')
  from private.shared_jev_consumers c join private.shared_jev_analyses a using(identity_sha256) where c.consumer_id=p_consumer and c.expires_at>clock_timestamp());
end $$;
revoke all on function public.jev_shared_read(uuid) from public,anon,authenticated;
grant execute on function public.jev_shared_read(uuid) to service_role;

create function public.jev_shared_allocate(p_consumer uuid,p_refs jsonb) returns jsonb language plpgsql set search_path='' as $$
declare src jsonb;r jsonb;x jsonb;key text;a private.shared_jev_analyses;t record;expiry timestamptz;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 src=private.shared_jev_source(p_consumer);expiry=(src->>'expires_at')::timestamptz;
 perform pg_advisory_xact_lock(hashtextextended('shared-jev:'||(src->>'establishment_id'),0));
 if jsonb_typeof(p_refs)<>'array' or jsonb_array_length(p_refs)<>(select count(*) from jsonb_array_elements(src#>'{snapshot,reviews}') item where nullif(item->>'analysis_text','') is not null) then raise exception 'SHARED_JEV_REFERENCE_SET_CHANGED';end if;
 for x in select value from jsonb_array_elements(p_refs) loop
  select value into r from jsonb_array_elements(src#>'{snapshot,reviews}') where value->>'id'=x->>'review_id';key=x->>'sha256';
  if r is null or nullif(r->>'google_review_id','') is null or nullif(r->>'analysis_text','') is null
   or x->'body' is distinct from jsonb_build_object('version','shared-jev-initial-v1','model','jev-1.13.0',
    'configuration_sha256','14c20d5525a70b200a711a41ae5e281ea64eaac910196d0a733bed64701930e3',
    'instructions_sha256','3a82a9c032217a0d10ba8a9ceccdafb71bc702366145d5837a324af580c20d22','parser','jev-direct-categories-parser-v1.1-rounding',
    'organization_id',src->>'organization_id','establishment_id',src->>'establishment_id','google_review_id',r->>'google_review_id',
    'analysis_text_sha256',encode(extensions.digest(r->>'analysis_text','sha256'),'hex'),'analysis_language',coalesce(r->>'analysis_language','und'))
   or public.jls_restaurant_hash(x->'body') is distinct from key then raise exception 'SHARED_JEV_IDENTITY_CHANGED';end if;
  insert into private.shared_jev_analyses(identity_sha256,organization_id,establishment_id,google_review_id,identity,owner_consumer)
   values(key,(src->>'organization_id')::uuid,(src->>'establishment_id')::uuid,r->>'google_review_id',x->'body',p_consumer) on conflict do nothing;
  select * into a from private.shared_jev_analyses where identity_sha256=key for update;
  -- On-demand legacy adoption only. Same UUID is linked to its Google ID by a
  -- live immutable review or a Google ID in the old frozen snapshot. No guess.
  if a.state='pending' and a.task_id is null then
   select bt.id,bt.status,bt.receipt_sha256,bt.request_sha256,bt.projection,bt.projection_sha256,rv.value saved,
    pr.value projected,br.current_source_run_id into t
   from public.analysis_jev_batch_runs br join public.analysis_jev_batch_tasks bt on bt.run_id=br.id
   cross join lateral jsonb_array_elements(br.snapshot->'reviews') rv(value)
   left join lateral jsonb_array_elements(bt.projection->'rows') pr(value) on pr.value->>'review_id'=rv.value->>'id'
   where br.organization_id=a.organization_id and br.establishment_id=a.establishment_id and br.configuration_version='jev-multi-review-initial-v1'
    and rv.value->>'analysis_text'=r->>'analysis_text' and coalesce(rv.value->>'analysis_language','und')=coalesce(r->>'analysis_language','und')
    and (rv.value->>'google_review_id'=a.google_review_id or exists(select 1 from public.reviews v where v.id=(rv.value->>'id')::uuid and v.establishment_id=a.establishment_id and v.external_review_id=a.google_review_id))
    and exists(select 1 from jsonb_each(bt.mapping) m where m.value->>'review_id'=rv.value->>'id')
    and (bt.request_wire::jsonb)->>'model'='jev-1.13.0'
    and public.jls_restaurant_hash(bt.request_wire::jsonb#>'{state,consignes_communes}')='3a82a9c032217a0d10ba8a9ceccdafb71bc702366145d5837a324af580c20d22'
    and (bt.status in('pending','reserved','received','unknown','invalid_output') or bt.status='completed' and pr.value is not null and public.jls_restaurant_hash(bt.projection)=bt.projection_sha256
     and bt.projection->>'parent_receipt_sha256'=bt.receipt_sha256 and bt.receipt->>'served_model'='jev-1.13.0')
   order by case bt.status when 'completed' then 0 when 'unknown' then 1 else 2 end,bt.id limit 1;
   if found then
    update private.shared_jev_analyses set task_id=t.id,source_review_id=(t.saved->>'id')::uuid,
     state=case t.status when 'completed' then 'ready' when 'unknown' then 'unknown' when 'invalid_output' then 'failed' else 'pending' end,
     result=case when t.status='completed' then t.projected->'result' end,result_sha256=case when t.status='completed' then public.jls_restaurant_hash(t.projected->'result') end,
     receipt_sha256=t.receipt_sha256,request_sha256=t.request_sha256,question_keys=t.projected->'question_keys',updated_at=clock_timestamp() where identity_sha256=key;
   end if;
  end if;
  insert into private.shared_jev_consumers values(p_consumer,(r->>'id')::uuid,key,expiry) on conflict(consumer_id,review_id) do nothing;
  if not exists(select 1 from private.shared_jev_consumers where consumer_id=p_consumer and review_id=(r->>'id')::uuid and identity_sha256=key) then raise exception 'SHARED_JEV_FROZEN_REFERENCE_CHANGED';end if;
 end loop;
 if (select count(*) from private.shared_jev_consumers where consumer_id=p_consumer)<>jsonb_array_length(p_refs) then raise exception 'SHARED_JEV_REFERENCE_DUPLICATED';end if;
 return public.jev_shared_read(p_consumer);
end $$;
revoke all on function public.jev_shared_allocate(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.jev_shared_allocate(uuid,jsonb) to service_role;

-- The queue owner is allocated before tokenization. Both entry points call this
-- same transaction; a second consumer waits on its owner, never builds a copy.
create function private.shared_jev_bind(p_consumer uuid,p_run uuid,p_planned jsonb) returns void language plpgsql set search_path='' as $$
declare ids jsonb;actual jsonb;begin
 perform pg_advisory_xact_lock(hashtextextended('shared-jev:'||(select establishment_id::text from public.analysis_jev_batch_runs where id=p_run),0));
 select coalesce(jsonb_agg(c.review_id::text order by c.review_id::text),'[]') into ids from private.shared_jev_consumers c join private.shared_jev_analyses a using(identity_sha256)
 where c.consumer_id=p_consumer and a.owner_consumer=p_consumer and a.state='pending' and a.task_id is null;
 select coalesce(jsonb_agg(value order by value),'[]') into actual from jsonb_array_elements(p_planned);
 if ids is distinct from actual then raise exception 'SHARED_JEV_PLAN_OWNERSHIP_CHANGED';end if;
 update private.shared_jev_analyses a set task_id=t.id,source_review_id=c.review_id,request_sha256=t.request_sha256
 from private.shared_jev_consumers c join public.analysis_jev_batch_tasks t on t.run_id=p_run
 where c.consumer_id=p_consumer and a.identity_sha256=c.identity_sha256 and a.owner_consumer=p_consumer and a.task_id is null
 and exists(select 1 from jsonb_each(t.mapping) m where m.value->>'review_id'=c.review_id::text);
 if exists(select 1 from private.shared_jev_consumers c join private.shared_jev_analyses a using(identity_sha256) where c.consumer_id=p_consumer and a.owner_consumer=p_consumer and a.state='pending' and a.task_id is null) then raise exception 'SHARED_JEV_TASK_BINDING_MISSING';end if;
end $$;
revoke all on function private.shared_jev_bind(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.shared_jev_bind(uuid,uuid,jsonb) to service_role;

-- Incorporates saved native projections; there is no second provider transport.
create function public.jev_shared_refresh(p_run uuid) returns text language plpgsql set search_path='' as $$
declare b public.analysis_jev_batch_runs;consumer uuid;n integer;total integer;bad boolean;begin
 if current_user not in('service_role','postgres') then raise exception 'FORBIDDEN';end if;
 select * into b from public.analysis_jev_batch_runs where id=p_run;
 if b.shared_jev_version is null then return b.stage;end if;
 consumer=coalesce(b.current_source_run_id,b.id);
 perform pg_advisory_xact_lock(hashtextextended('shared-jev:'||b.establishment_id::text,0));
 update private.shared_jev_analyses a set state='ready',result=x.value->'result',result_sha256=public.jls_restaurant_hash(x.value->'result'),
  receipt_sha256=t.receipt_sha256,question_keys=x.value->'question_keys',updated_at=clock_timestamp()
 from public.analysis_jev_batch_tasks t cross join lateral jsonb_array_elements(t.projection->'rows') x(value)
 where a.task_id=t.id and a.state in('pending','unknown') and t.status='completed' and x.value->>'review_id'=a.source_review_id::text
 and public.jls_restaurant_hash(t.projection)=t.projection_sha256 and t.projection->>'parent_receipt_sha256'=t.receipt_sha256
 and t.receipt->>'served_model'='jev-1.13.0';
 update private.shared_jev_analyses a set state=case when t.status='unknown' then 'unknown' else 'failed' end,updated_at=clock_timestamp()
 from public.analysis_jev_batch_tasks t where a.task_id=t.id and a.state='pending' and t.status in('unknown','invalid_output');
 select count(*),count(*) filter(where a.state='ready'),coalesce(bool_or(a.state in('unknown','failed','expired')),false) into total,n,bad
 from private.shared_jev_consumers c join private.shared_jev_analyses a using(identity_sha256) where c.consumer_id=consumer;
 if b.status<>'running' or not b.armed then return b.stage;end if;
 update public.analysis_parallel_reports set statistics=jsonb_set(statistics,'{scope,analysed_text_reviews}',to_jsonb(n)) where id=b.report_id;
 if bad then
  update public.analysis_jev_batch_runs set status='blocked',armed=false,error_code='SHARED_JEV_PREVIOUS_ATTEMPT_BLOCKED' where id=b.id;
  update public.analysis_parallel_reports set state='blocked',error_code='SHARED_JEV_PREVIOUS_ATTEMPT_BLOCKED' where id=b.report_id;
  return 'blocked';
 end if;
 if n=total and b.stage in('jev','shared_wait') then
  if b.purpose='new_reviews' then update public.analysis_jev_batch_runs set status='completed',stage='completed',armed=false,completed_at=clock_timestamp() where id=b.id;return 'completed';
  else update public.analysis_jev_batch_runs set stage='prepare_evidence' where id=b.id;return 'prepare_evidence';end if;
 elsif b.stage='jev' and not exists(select 1 from public.analysis_jev_batch_tasks where run_id=b.id and status<>'completed') then
  update public.analysis_jev_batch_runs set stage='shared_wait' where id=b.id;return 'shared_wait';
 end if;
 return b.stage;
end $$;
revoke all on function public.jev_shared_refresh(uuid) from public,anon,authenticated;
grant execute on function public.jev_shared_refresh(uuid) to service_role;

-- Validation-only lease for a late already-saved receipt. It never reserves a
-- provider attempt, rearms a job, or republishes a blocked/obsolete generation.
create function public.jev_shared_claim_saved(p_run uuid,p_worker text) returns jsonb language plpgsql set search_path='' as $$
declare t public.analysis_jev_batch_tasks;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if not exists(select 1 from public.analysis_jev_batch_runs where id=p_run and shared_jev_version='shared-jev-initial-v1' and expires_at>clock_timestamp()) then return null;end if;
 select * into t from public.analysis_jev_batch_tasks where run_id=p_run and status='received' and request_count=1 and receipt is not null
  and (lease_until is null or lease_until<clock_timestamp()) order by number for update skip locked limit 1;
 if t.id is null then return null;end if;
 update public.analysis_jev_batch_tasks set worker=p_worker,lease_until=clock_timestamp()+interval '150 seconds' where id=t.id returning * into t;
 return to_jsonb(t);
end $$;
revoke all on function public.jev_shared_claim_saved(uuid,text) from public,anon,authenticated;
grant execute on function public.jev_shared_claim_saved(uuid,text) to service_role;

-- Create only an analysis job, from newly inserted retained reviews, in the
-- successful sync transaction. No parallel report or Sol operation is created.
create function private.enqueue_new_review_jev(p_job uuid,p_ids uuid[]) returns uuid language plpgsql set search_path='' as $$
declare j public.review_sync_jobs;e public.establishments;snapshot jsonb;bid uuid;begin
 select * into j from public.review_sync_jobs where id=p_job;
 select * into e from public.establishments where id=j.establishment_id;
 if cardinality(p_ids)=0 or e.id is null or j.status<>'completed' or e.organization_id is distinct from j.organization_id
  or not exists(select 1 from private.shared_jev_runtime where enabled) then return null;end if;
 select jsonb_build_object('organization_id',e.organization_id,'establishment_id',e.id,'language',j.collection_language,'reviews',jsonb_agg(
  jsonb_build_object('id',r.id,'external_review_id',r.external_review_id,'original_text',r.original_text,'text',r.text,'original_language',r.original_language,
   'review_translations',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'language',t.language,'translated_text',t.translated_text,'source_text_sha256',t.source_text_sha256)) from public.review_translations t where t.review_id=r.id),'[]')) order by r.id)) into snapshot
 from public.reviews r where r.establishment_id=e.id and r.id=any(p_ids) and public.review_usable_text(r.original_text,r.text) is not null;
 if snapshot->'reviews'='null'::jsonb then return null;end if;
 insert into public.analysis_jev_batch_runs(organization_id,establishment_id,purpose,shared_jev_version,policy_epoch,sync_job_id,stage,snapshot,snapshot_sha256,
  template,manifest,manifest_sha256,source_manifest_sha256,authorization_evidence,expires_at,max_new_jev_calls,armed)
 values(e.organization_id,e.id,'new_reviews','shared-jev-initial-v1',(select epoch from public.review_corpus_policy where id),j.id,'auto_prepare',snapshot,public.jls_restaurant_hash(snapshot),
  '{}','{}',public.jls_restaurant_hash('{}'::jsonb),public.jls_restaurant_hash('{}'::jsonb),'Successful incremental sync: new textual reviews only; existing JEV batch queue; no Sol.',clock_timestamp()+interval '24 hours',0,true)
 on conflict(sync_job_id) where sync_job_id is not null do nothing returning id into bid;
 if bid is not null then perform public.jev_batch_wake(bid);end if;return bid;
end $$;
revoke all on function private.enqueue_new_review_jev(uuid,uuid[]) from public,anon,authenticated;
grant execute on function private.enqueue_new_review_jev(uuid,uuid[]) to service_role;

-- Preserve reusable legacy classifications just before their disposable source
-- is retired by normal rotation/supersession. No analysis or deployment backfill.
create function private.preserve_retiring_shared_jev(p_source uuid) returns void language plpgsql security definer set search_path='' as $$
declare b public.analysis_jev_batch_runs;x record;identity jsonb;key text;begin
 select * into b from public.analysis_jev_batch_runs where current_source_run_id=p_source;
 if b.id is null then return;end if;
 perform pg_advisory_xact_lock(hashtextextended('shared-jev:'||b.establishment_id::text,0));
 for x in select t.id task_id,t.request_sha256,t.receipt_sha256,rv.value source,pr.value projected,r.external_review_id
  from public.analysis_jev_batch_tasks t cross join lateral jsonb_array_elements(t.projection->'rows') pr(value)
  join lateral jsonb_array_elements(b.snapshot->'reviews') rv(value) on rv.value->>'id'=pr.value->>'review_id'
  join public.reviews r on r.id=(rv.value->>'id')::uuid and r.organization_id=b.organization_id and r.establishment_id=b.establishment_id
  where t.run_id=b.id and t.status='completed' and t.receipt->>'served_model'='jev-1.13.0'
   and public.jls_restaurant_hash(t.projection)=t.projection_sha256 and t.projection->>'parent_receipt_sha256'=t.receipt_sha256
   and public.jls_restaurant_hash(t.request_wire::jsonb#>'{state,consignes_communes}')='3a82a9c032217a0d10ba8a9ceccdafb71bc702366145d5837a324af580c20d22'
   and t.request_wire::jsonb#>>array['state','avis','review_'||r.id::text]=rv.value->>'analysis_text'
   and nullif(r.external_review_id,'') is not null
 loop
  identity=jsonb_build_object('version','shared-jev-initial-v1','model','jev-1.13.0',
   'configuration_sha256','14c20d5525a70b200a711a41ae5e281ea64eaac910196d0a733bed64701930e3',
   'instructions_sha256','3a82a9c032217a0d10ba8a9ceccdafb71bc702366145d5837a324af580c20d22','parser','jev-direct-categories-parser-v1.1-rounding',
   'organization_id',b.organization_id,'establishment_id',b.establishment_id,'google_review_id',x.external_review_id,
   'analysis_text_sha256',encode(extensions.digest(x.source->>'analysis_text','sha256'),'hex'),'analysis_language',coalesce(x.source->>'analysis_language','und'));
  key=public.jls_restaurant_hash(identity);
  insert into private.shared_jev_analyses(identity_sha256,organization_id,establishment_id,google_review_id,identity,owner_consumer,task_id,source_review_id,state,result,result_sha256,receipt_sha256,request_sha256,question_keys)
   values(key,b.organization_id,b.establishment_id,x.external_review_id,identity,p_source,x.task_id,(x.source->>'id')::uuid,'ready',x.projected->'result',public.jls_restaurant_hash(x.projected->'result'),x.receipt_sha256,x.request_sha256,x.projected->'question_keys') on conflict do nothing;
 end loop;
end $$;
revoke all on function private.preserve_retiring_shared_jev(uuid) from public,anon,authenticated;
grant execute on function private.preserve_retiring_shared_jev(uuid) to service_role;

create function public.jev_shared_normalize_auto(p_run uuid,p_snapshot jsonb,p_sha text) returns boolean language plpgsql set search_path='' as $$
declare b public.analysis_jev_batch_runs;x jsonb;r jsonb;begin
 if current_user<>'service_role' or public.jls_restaurant_hash(p_snapshot) is distinct from p_sha then raise exception 'FORBIDDEN';end if;
 select * into b from public.analysis_jev_batch_runs where id=p_run for update;
 if b.purpose<>'new_reviews' or not b.armed or b.status<>'running' or b.expires_at<=clock_timestamp() then return false;end if;
 if b.stage<>'auto_prepare' then return b.snapshot_sha256=p_sha;end if;
 if jsonb_array_length(p_snapshot->'reviews') is distinct from jsonb_array_length(b.snapshot->'reviews') then raise exception 'SHARED_JEV_AUTO_SOURCE_CHANGED';end if;
 for x in select value from jsonb_array_elements(p_snapshot->'reviews') loop
  select value into r from jsonb_array_elements(b.snapshot->'reviews') where value->>'id'=x->>'id';
  if r is null or x->>'google_review_id' is distinct from r->>'external_review_id' or x->>'original_text' is distinct from r->>'original_text'
   or x->>'text' is distinct from r->>'text' or x->'review_translations' is distinct from r->'review_translations'
   or x->>'organization_id' is distinct from b.organization_id::text or x->>'establishment_id' is distinct from b.establishment_id::text
   or nullif(x->>'analysis_text','') is null or x->>'analysis_text_sha256' is distinct from encode(extensions.digest(x->>'analysis_text','sha256'),'hex')
   or not(x->>'analysis_text'=coalesce(nullif(r->>'original_text',''),r->>'text','') or exists(select 1 from jsonb_array_elements(r->'review_translations') t
    where t->>'translated_text'=x->>'analysis_text' and t->>'language'=b.snapshot->>'language' and t->>'source_text_sha256'=encode(extensions.digest(coalesce(nullif(r->>'original_text',''),r->>'text',''),'sha256'),'hex')))
   then raise exception 'SHARED_JEV_AUTO_TEXT_CHANGED';end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_snapshot->'reviews'))<>jsonb_array_length(p_snapshot->'reviews') then raise exception 'SHARED_JEV_DUPLICATE_REVIEW';end if;
 perform set_config('home.shared_jev_materialize','on',true);
 update public.analysis_jev_batch_runs set snapshot=p_snapshot,snapshot_sha256=p_sha,stage='auto_plan' where id=b.id;
 perform set_config('home.shared_jev_materialize','',true);perform public.jev_batch_wake(b.id);return true;
end $$;
revoke all on function public.jev_shared_normalize_auto(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.jev_shared_normalize_auto(uuid,jsonb,text) to service_role;

create function public.jev_shared_plan_auto(p_run uuid,p_plans jsonb) returns boolean language plpgsql set search_path='' as $$
declare r public.analysis_jev_batch_runs;b jsonb;n int=0;ids jsonb;actual jsonb;payload jsonb;avis jsonb;mapping jsonb;questions jsonb;v_manifest jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jev_batch_runs where id=p_run;
 perform pg_advisory_xact_lock(hashtextextended('shared-jev:'||r.establishment_id::text,0));
 select * into r from public.analysis_jev_batch_runs where id=p_run for update;
 if r.purpose<>'new_reviews' or not r.armed or r.status<>'running' or r.expires_at<=clock_timestamp() then return false;end if;
 if r.stage<>'auto_plan' then return r.manifest->'plans'=p_plans;end if;
 if jsonb_typeof(p_plans)<>'array' then raise exception 'SHARED_JEV_PLAN_INVALID';end if;
 for b in select value from jsonb_array_elements(p_plans) loop
  n=n+1;payload=(b->>'request_wire')::jsonb;
  if not coalesce((b->>'number')::int=n and (b->>'reviews')::int between 1 and 50 and jsonb_array_length(b->'review_ids')=(b->>'reviews')::int
   and b#>>'{preflight,passed}'='true' and b#>>'{preflight,truncated_reviews}'='0' and (b#>>'{preflight,guarded_total_tokens}')::int<=64000
   and (b#>>'{preflight,guarded_largest_pair_tokens}')::int<=32000 and octet_length(b->>'request_wire')<=33554432
   and b->>'request_sha256'=encode(extensions.digest(b->>'request_wire','sha256'),'hex')
   and public.jls_restaurant_hash(payload#>'{state,consignes_communes}')='3a82a9c032217a0d10ba8a9ceccdafb71bc702366145d5837a324af580c20d22',false) then raise exception 'CURRENT_BATCH_REQUEST_GUARD_CHANGED';end if;
  select jsonb_object_agg('review_'||i.id,x->>'analysis_text') into avis from jsonb_array_elements_text(b->'review_ids') i(id)
   join jsonb_array_elements(r.snapshot->'reviews') x on x->>'id'=i.id;
  select jsonb_object_agg('r'||lpad(i.ord::text,3,'0')||'_'||cat,jsonb_build_object('review_id',i.id,'category',cat)),
   jsonb_object_agg('r'||lpad(i.ord::text,3,'0')||'_'||cat,jsonb_build_object('type','choice','instructions','Classe '||cat||' pour le seul avis review_'||i.id||' selon consignes_communes.',
    'criteria','{"positive":null,"negative":null,"mixed":null,"neutral":null,"uncertain":null,"not_mentioned":null}'::jsonb)) into mapping,questions
   from jsonb_array_elements_text(b->'review_ids') with ordinality i(id,ord) cross join unnest(array['service','price','quality','ambiance']) cat;
  if b->'mapping' is distinct from mapping or payload is distinct from jsonb_build_object('model','jev-1.13.0','state',jsonb_build_object('avis',avis,'consignes_communes',payload#>'{state,consignes_communes}'),'questions',questions) then raise exception 'CURRENT_BATCH_MAPPING_OR_TEXT_CHANGED';end if;
 end loop;
 v_manifest=jsonb_build_object('version','shared-jev-initial-v1','purpose','new_reviews','plans',p_plans,'max_sol_calls',0,'automatic_retry',false);
 perform set_config('home.shared_jev_materialize','on',true);
 update public.analysis_jev_batch_runs set manifest=v_manifest,manifest_sha256=public.jls_restaurant_hash(v_manifest),source_manifest_sha256=public.jls_restaurant_hash(v_manifest),
  max_new_jev_calls=n,stage='jev' where id=r.id;
 perform set_config('home.shared_jev_materialize','',true);
 insert into public.analysis_jev_batch_tasks(run_id,organization_id,number,reviews,request_wire,request_sha256,mapping,preflight)
 select r.id,r.organization_id,(pb->>'number')::int,(pb->>'reviews')::int,pb->>'request_wire',pb->>'request_sha256',pb->'mapping',pb->'preflight' from jsonb_array_elements(p_plans) pb;
 select coalesce(jsonb_agg(i.id order by i.id),'[]') into actual from jsonb_array_elements(p_plans) p cross join lateral jsonb_array_elements_text(p->'review_ids') i(id);
 perform private.shared_jev_bind(r.id,r.id,actual);perform public.jev_shared_refresh(r.id);perform public.jev_batch_wake(r.id);return true;
end $$;
revoke all on function public.jev_shared_plan_auto(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.jev_shared_plan_auto(uuid,jsonb) to service_role;

-- Small guarded patches to the deployed functions preserve all their existing
-- checks. Abort installation if a required boundary has changed.
do $patch$
declare d text;a text;begin
 d=pg_get_functiondef('public.freeze_recent_review_source(uuid,uuid,text,timestamptz)'::regprocedure);
 a='jsonb_build_object(''id'',r.id,''rating'',r.rating';
 if position(a in d)=0 then raise exception 'SHARED_FREEZE_PATCH_DRIFT';end if;
 execute replace(d,a,'jsonb_build_object(''id'',r.id,''external_review_id'',r.external_review_id,''rating'',r.rating');

 d=pg_get_functiondef('private.enqueue_review_ai()'::regprocedure);
 a='if new.historical_import';if position(a in d)=0 then raise exception 'SHARED_LEGACY_TRIGGER_PATCH_DRIFT';end if;
 execute replace(d,a,'if current_setting(''home.shared_jev_sync'',true)=''on'' or new.historical_import');

 d=pg_get_functiondef('public.commit_incremental_review_sync(uuid,text,jsonb,jsonb)'::regprocedure);
 a='ingested=public.ingest_recent_reviews(e.id,e.organization_id,p_bundle,''apify'');';
 if position(a in d)=0 then raise exception 'SHARED_SYNC_PATCH_DRIFT';end if;
 d=replace(d,a,'perform set_config(''home.shared_jev_sync'',''on'',true);'||a||'perform set_config(''home.shared_jev_sync'','''',true);');
 a='return answer;';if position(a in d)=0 then raise exception 'SHARED_SYNC_RETURN_DRIFT';end if;
 d=replace(d,a,'perform private.enqueue_new_review_jev(j.id,array(select id from unnest(after_ids) id where not(id=any(old_ids))));'||a);execute d;

 d=pg_get_functiondef('public.prepare_current_v2_protocol(uuid,jsonb,text)'::regprocedure);
 a='or dst.v->>''original_text'' is distinct from';if position(a in d)=0 then raise exception 'SHARED_PROTOCOL_PATCH_DRIFT';end if;
 execute replace(d,a,'or q.shared_jev_version is not null and dst.v->>''google_review_id'' is distinct from src.v->>''external_review_id'' '||a);

 d=pg_get_functiondef('private.retention_retire_source(uuid,text)'::regprocedure);
 a='select * into b from public.analysis_jev_batch_runs where current_source_run_id=p_source;';
 if position(a in d)=0 then raise exception 'SHARED_RETIRE_PATCH_DRIFT';end if;
 d=replace(d,a,'if p_reason in(''CORPUS_REVIEW_REMOVED'',''CORPUS_CHANGED'',''REVIEW_METADATA_CHANGED'') and private.shared_jev_frozen_allowed(p_source) and s.status in(''queued'',''running'',''retry'') then return false;end if;
 if exists(select 1 from public.report_generation_requests where source_run_id=p_source and shared_jev_version is not null)
 and exists(select 1 from public.analysis_jev_batch_tasks bt join public.analysis_jev_batch_runs br on br.id=bt.run_id where br.current_source_run_id=p_source and bt.request_count=1 and bt.receipt is null and bt.lease_until>clock_timestamp()) then return false;end if; '||a);
 a='delete from public.report_corpus_scopes where source_run_id=p_source;';
 d=replace(d,a,'perform private.preserve_retiring_shared_jev(p_source);delete from private.shared_jev_consumers where consumer_id=p_source; '||a);execute d;

 d=pg_get_functiondef('private.store_current_report_publication(jsonb,jsonb,timestamptz,boolean)'::regprocedure);
 a='if is_stale and not p_recovery then return false;end if;';
 if position(a in d)=0 then raise exception 'SHARED_PUBLICATION_PATCH_DRIFT';end if;
 execute replace(d,a,'if is_stale and not p_recovery and not private.shared_jev_frozen_allowed((p->>''current_source_run_id'')::uuid) then return false;end if;');

 d=pg_get_functiondef('private.retention_publication_guard()'::regprocedure);
 a='if new.state in(''completed'',''needs_review'') and (sc.stale or sc.fingerprint<>public.review_corpus_fingerprint(new.establishment_id)) then';
 if position(a in d)=0 then raise exception 'SHARED_PUBLICATION_GUARD_DRIFT';end if;
 execute replace(d,a,'if new.state in(''completed'',''needs_review'') and (sc.stale or sc.fingerprint<>public.review_corpus_fingerprint(new.establishment_id)) and not private.shared_jev_frozen_allowed(new.current_source_run_id) then');

 d=pg_get_functiondef('public.retention_batch_allowed(uuid)'::regprocedure);
 a='if b.id is null or b.current_source_run_id is null then return false;end if;';
 if position(a in d)=0 then raise exception 'SHARED_RETENTION_PATCH_DRIFT';end if;
 d=replace(d,a,'if b.id is null then return false;end if;
 if exists(select 1 from public.analysis_jev_batch_tasks t join private.provider_attempt_ledger l on l.request_sha256=t.request_sha256 and l.outcome=''unknown'' and l.provider=''jev'' where t.run_id=b.id and t.status=''pending'' and t.request_count=0) then
  update public.analysis_jev_batch_runs set armed=false,status=''blocked'',error_code=''PREVIOUS_IDENTICAL_REQUEST_OUTCOME_UNKNOWN'' where id=b.id;return false;end if;
 if b.purpose=''new_reviews'' then return b.shared_jev_version=''shared-jev-initial-v1'' and b.policy_epoch=p.epoch and b.expires_at>clock_timestamp()
  and exists(select 1 from public.establishments where id=b.establishment_id and organization_id=b.organization_id and active and (review_reload_barrier_at is null or b.created_at>=review_reload_barrier_at));end if;
 if b.current_source_run_id is null then return false;end if;');
 a='sc.stale or sc.fingerprint<>public.review_corpus_fingerprint(b.establishment_id)';
 if position(a in d)=0 then raise exception 'SHARED_RETENTION_FINGERPRINT_DRIFT';end if;
 execute replace(d,a,'(sc.stale or sc.fingerprint<>public.review_corpus_fingerprint(b.establishment_id)) and not private.shared_jev_frozen_allowed(b.current_source_run_id)');

 d=pg_get_functiondef('public.guard_batch_frozen_data()'::regprocedure);
 a='else'||chr(10)||'  if new.snapshot';if position(a in d)=0 then raise exception 'SHARED_GUARD_PATCH_DRIFT';end if;
 d=replace(d,a,'else
  if row(new.purpose,new.shared_jev_version,new.policy_epoch,new.sync_job_id) is distinct from row(old.purpose,old.shared_jev_version,old.policy_epoch,old.sync_job_id) then raise exception ''BATCH_FROZEN_RUN_CHANGED'';end if;
  if old.purpose=''new_reviews'' and old.stage in(''auto_prepare'',''auto_plan'') and current_setting(''home.shared_jev_materialize'',true)=''on''
   and old.sol_request_count=0 and old.max_new_jev_calls=0 and not exists(select 1 from public.analysis_jev_batch_tasks where run_id=old.id)
   and new.organization_id=old.organization_id and new.establishment_id=old.establishment_id and new.expires_at=old.expires_at
   and new.authorization_evidence=old.authorization_evidence then return new;end if;
  if new.snapshot');
 a='old.current_source_run_id is not null and row(new.max_new_jev_calls,new.expires_at,new.authorization_evidence)';
 if position(a in d)=0 then raise exception 'SHARED_AUTO_BUDGET_GUARD_DRIFT';end if;
 execute replace(d,a,'(old.current_source_run_id is not null or old.purpose=''new_reviews'') and row(new.max_new_jev_calls,new.expires_at,new.authorization_evidence)');
end $patch$;

do $patch$
declare d text;a text;begin
 d=pg_get_functiondef('public.jev_batch_create_current(uuid,jsonb,text)'::regprocedure);
 a='select id into r from public.analysis_jev_batch_runs where current_source_run_id=p_source;';
 if position(a in d)=0 then raise exception 'SHARED_CREATE_PATCH_DRIFT';end if;
 d=replace(d,a,'if q.shared_jev_version is distinct from p_manifest->>''shared_jev_version'' or q.shared_jev_version is not null and q.shared_jev_version<>''shared-jev-initial-v1'' then raise exception ''SHARED_JEV_VERSION_CHANGED'';end if; '||a);
 a='and jsonb_array_length(p_manifest->''plans'')>0';if position(a in d)=0 then raise exception 'SHARED_CREATE_EMPTY_DRIFT';end if;
 d=replace(d,a,'and (q.shared_jev_version is not null or jsonb_array_length(p_manifest->''plans'')>0)');
 a='if ids is distinct from actual_ids then raise exception ''CURRENT_BATCH_REVIEW_SET_CHANGED'';end if;';
 if position(a in d)=0 then raise exception 'SHARED_CREATE_SET_DRIFT';end if;
 d=replace(d,a,'if q.shared_jev_version is null then '||a||' else
 if ids is distinct from (select jsonb_agg(review_id::text order by review_id::text) from private.shared_jev_consumers where consumer_id=p_source and expires_at>clock_timestamp()) then raise exception ''SHARED_JEV_REFERENCE_SET_CHANGED'';end if;
 end if;');
 a='max_new_jev_calls,armed)';if position(a in d)=0 then raise exception 'SHARED_CREATE_INSERT_DRIFT';end if;
 d=replace(d,a,'max_new_jev_calls,armed,shared_jev_version,policy_epoch)');
 a='s.created_at+interval ''24 hours'',n,true) returning id into r;';
 if position(a in d)=0 then raise exception 'SHARED_CREATE_VALUES_DRIFT';end if;
 d=replace(d,a,'s.created_at+interval ''24 hours'',n,true,q.shared_jev_version,(select epoch from public.review_corpus_policy where id)) returning id into r;');
 a='update public.report_generation_requests set comparison_id=v where id=q.id;';
 d=replace(d,a,'if q.shared_jev_version is not null then perform private.shared_jev_bind(p_source,r,coalesce(actual_ids,''[]''::jsonb));perform public.jev_shared_refresh(r);end if; '||a);execute d;

 d=pg_get_functiondef('public.jev_batch_claim_sol(uuid,text)'::regprocedure);
 a='if not public.retention_batch_allowed(p_run) then return false;end if;';
 if position(a in d)=0 then raise exception 'SHARED_SOL_CLAIM_DRIFT';end if;
 execute replace(d,a,'if exists(select 1 from public.analysis_jev_batch_runs where id=p_run and purpose<>''report'') then return false;end if; '||a);

 d=pg_get_functiondef('public.jev_batch_save_projection(uuid,text,jsonb,text,text)'::regprocedure);
 a='select * into t from public.analysis_jev_batch_tasks where id=p_task for update;';
 if position(a in d)=0 then raise exception 'SHARED_PROJECT_LOCK_DRIFT';end if;
 d=replace(d,a,'perform pg_advisory_xact_lock(hashtextextended(''shared-jev:''||(select br.establishment_id::text from public.analysis_jev_batch_runs br join public.analysis_jev_batch_tasks bt on bt.run_id=br.id where bt.id=p_task),0)); '||a);
 a='perform public.jev_batch_wake(r.id);return true;';
 if position(a in d)=0 then raise exception 'SHARED_PROJECT_WAKE_DRIFT';end if;
 d=replace(d,a,'if r.shared_jev_version is not null then update public.analysis_jev_batch_runs set stage=''jev'' where id=r.id;perform public.jev_shared_refresh(r.id);end if;
 -- Wake consumers of this native task, including an automatic producer and a manual waiter.
 perform public.jev_shared_refresh(br.id) from public.analysis_jev_batch_runs br where br.armed and br.status=''running'' and br.stage in(''jev'',''shared_wait'') and br.shared_jev_version is not null
 and exists(select 1 from private.shared_jev_consumers c join private.shared_jev_analyses sa using(identity_sha256) where c.consumer_id=coalesce(br.current_source_run_id,br.id) and sa.task_id=t.id);
 perform public.jev_batch_wake(br.id) from public.analysis_jev_batch_runs br where br.armed and br.status=''running'' and br.shared_jev_version is not null
 and exists(select 1 from private.shared_jev_consumers c join private.shared_jev_analyses sa using(identity_sha256) where c.consumer_id=coalesce(br.current_source_run_id,br.id) and sa.task_id=t.id);
 '||a);execute d;

 d=pg_get_functiondef('public.jev_batch_claim(uuid,text)'::regprocedure);
 a='perform pg_advisory_xact_lock(hashtextextended(''jev-native-batch-account-slot-v1'',0));';
 if position(a in d)=0 then raise exception 'SHARED_CLAIM_LOCK_DRIFT';end if;
 execute replace(d,a,'perform pg_advisory_xact_lock(hashtextextended(''shared-jev:''||(select establishment_id::text from public.analysis_jev_batch_runs where id=p_run),0)); '||a);
end $patch$;

-- Expired snapshots are removed by the existing recovery cron, not archived.
-- Unknown/failed identities keep only a technical fence and never become pending.
create function private.cleanup_shared_jev() returns void language plpgsql security definer set search_path='' as $$
declare r record;prior text;begin
 delete from private.shared_jev_consumers where expires_at<=clock_timestamp();
 update private.shared_jev_analyses a set state='expired',updated_at=clock_timestamp() where state='pending' and created_at+interval '24 hours'<=clock_timestamp()
  and not exists(select 1 from public.analysis_jev_batch_tasks where id=a.task_id and status in('received','completed'));
 delete from private.shared_jev_analyses a where state='ready' and not exists(select 1 from private.shared_jev_consumers c where c.identity_sha256=a.identity_sha256)
  and not exists(select 1 from public.reviews live where live.establishment_id=a.establishment_id and live.external_review_id=a.google_review_id
   and (a.identity->>'analysis_text_sha256'=encode(extensions.digest(coalesce(nullif(live.original_text,''),live.text,''),'sha256'),'hex')
    or exists(select 1 from public.review_translations tr where tr.review_id=live.id and tr.language in('fr','vi')
     and tr.source_text_sha256=encode(extensions.digest(coalesce(nullif(live.original_text,''),live.text,''),'sha256'),'hex')
     and a.identity->>'analysis_text_sha256'=encode(extensions.digest(tr.translated_text,'sha256'),'hex'))));
 for r in select s.id from public.historical_report_runs s join public.report_generation_requests q on q.source_run_id=s.id
  where q.shared_jev_version is not null and s.created_at+interval '24 hours'<=clock_timestamp()
 loop perform private.retention_retire_source(r.id,'SHARED_FROZEN_DATA_EXPIRED');end loop;
 prior=current_setting('home.retention_maintenance',true);perform set_config('home.retention_maintenance','on',true);
 for r in select br.id from public.analysis_jev_batch_runs br where purpose='new_reviews' and expires_at<=clock_timestamp()
  and not exists(select 1 from public.analysis_jev_batch_tasks bt where bt.run_id=br.id and bt.request_count=1 and bt.receipt is null and bt.lease_until>clock_timestamp())
 loop
  perform private.record_retention_attempt('public.analysis_jev_batch_tasks',to_jsonb(t)) from public.analysis_jev_batch_tasks t where run_id=r.id;
  delete from private.shared_jev_consumers where consumer_id=r.id;
  delete from public.analysis_jev_batch_tasks where run_id=r.id;
  delete from public.analysis_jev_batch_runs where id=r.id;
 end loop;
 perform set_config('home.retention_maintenance',coalesce(prior,''),true);
end $$;
revoke all on function private.cleanup_shared_jev() from public,anon,authenticated;
grant execute on function private.cleanup_shared_jev() to service_role;

do $patch$
declare d text;a text;begin
 d=pg_get_functiondef('public.jev_batch_recover()'::regprocedure);
 a='where current_source_run_id is not null and armed and status=''running''';
 if position(a in d)=0 then raise exception 'SHARED_RECOVERY_PATCH_DRIFT';end if;
 d=replace(d,a,'where (current_source_run_id is not null or purpose=''new_reviews'') and armed and status=''running''');
 a='else perform public.jev_batch_wake(r.id);n=n+1;';
 if position(a in d)=0 then raise exception 'SHARED_RECOVERY_WAKE_DRIFT';end if;
 d=replace(d,a,'else if r.shared_jev_version is not null and r.stage in(''jev'',''shared_wait'') then perform public.jev_shared_refresh(r.id);end if;perform public.jev_batch_wake(r.id);n=n+1;');
 a='end loop;return n;';if position(a in d)=0 then raise exception 'SHARED_RECOVERY_END_DRIFT';end if;
 execute replace(d,a,'end loop;perform private.cleanup_shared_jev();return n;');
 d=pg_get_functiondef('public.jev_batch_continue_received(uuid,text)'::regprocedure);
 a='where current_source_run_id is not null and id<>t.run_id';if position(a in d)=0 then raise exception 'SHARED_CONTINUATION_DRIFT';end if;
 execute replace(d,a,'where (current_source_run_id is not null or purpose=''new_reviews'') and id<>t.run_id');
end $patch$;

-- Failed preparation is visible to all waiters. Never orphan an unassigned
-- identity in an apparently running state until its deadline.
create function private.shared_jev_failed_owner() returns trigger language plpgsql security definer set search_path='' as $$
declare consumer uuid;begin
 if tg_table_name='historical_report_runs' then
  if new.status<>'failed' then return new;end if;consumer=new.id;
 else
  if new.status='running' or new.shared_jev_version is null then return new;end if;consumer=coalesce(new.current_source_run_id,new.id);
 end if;
 update private.shared_jev_analyses a set state='failed',updated_at=clock_timestamp() where owner_consumer=consumer and state='pending'
  and (task_id is null or exists(select 1 from public.analysis_jev_batch_tasks t where t.id=a.task_id and t.request_count=0));
 return new;
end $$;
create trigger shared_jev_failed_source after update of status on public.historical_report_runs for each row execute function private.shared_jev_failed_owner();
create trigger shared_jev_failed_batch after update of status on public.analysis_jev_batch_runs for each row execute function private.shared_jev_failed_owner();
revoke all on function private.shared_jev_failed_owner() from public,anon,authenticated;
commit;
