begin;
set local lock_timeout='5s';
alter table public.review_sync_jobs
 add column incremental_version text,
 add column incremental_input jsonb,
 add column incremental_identity jsonb,
 add column incremental_build text,
 add column incremental_receipt jsonb,
 add column incremental_received integer,
 add column incremental_result jsonb;

create function public.reserve_incremental_review_sync(p_job uuid,p_worker text,p_input jsonb,p_build text) returns boolean
language plpgsql set search_path='' as $$
declare j public.review_sync_jobs;e public.establishments;target uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select establishment_id into target from public.review_sync_jobs where id=p_job;
 if target is null then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||target::text,0));
 select * into e from public.establishments where id=target for update;
 select * into j from public.review_sync_jobs where id=p_job for update;
 if j.status<>'running' or j.locked_by is distinct from left(p_worker,120) or j.lease_until<=clock_timestamp()
  or j.provider_start_attempted_at is not null or j.apify_run_id is not null then return false;end if;
 if j.checkpoint_review_id is null or j.checkpoint_review_at is null then raise exception 'SYNC_INCREMENTAL_CHECKPOINT_MISSING';end if;
 if j.checkpoint_review_at>clock_timestamp() or (j.checkpoint_review_id,j.checkpoint_review_at) is distinct from (e.last_review_id,e.last_review_at)
  or not exists(select 1 from public.reviews where establishment_id=e.id and external_review_id=j.checkpoint_review_id and published_at=j.checkpoint_review_at) then raise exception 'SYNC_INCREMENTAL_CHECKPOINT_INVALID';end if;
 if e.review_reload_barrier_at is not null and j.created_at<e.review_reload_barrier_at then raise exception 'SYNC_INCREMENTAL_OBSOLETE';end if;
 if p_build is distinct from '0.0.541' or p_input->>'reviewsSort' is distinct from 'newest' or p_input->>'reviewsOrigin' is distinct from 'google'
  or p_input->>'language' is distinct from j.collection_language or p_input->'maxReviews' is distinct from '150'::jsonb
  or jsonb_array_length(p_input->'startUrls') is distinct from 1 or nullif(p_input#>>'{startUrls,0,url}','') is null
  or nullif(p_input->>'reviewsStartDate','') is null or (p_input->>'reviewsStartDate')::timestamptz is distinct from j.checkpoint_review_at-interval '5 seconds' then raise exception 'SYNC_INCREMENTAL_INPUT_MISMATCH';end if;
 update public.review_sync_jobs set incremental_version='google-reviews-incremental-v1',incremental_input=p_input,incremental_build=p_build,
  incremental_identity=jsonb_build_object('google_id',e.google_id,'place_id',e.place_id,'google_maps_url',e.google_maps_url,'organization_id',e.organization_id)
 where id=j.id;
 return public.reserve_review_sync_start(p_job,p_worker);
end$$;

create function public.observe_incremental_review_sync(p_job uuid,p_worker text,p_run text,p_receipt jsonb,p_received integer default null) returns boolean
language plpgsql set search_path='' as $$begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_receipt->>'id' is distinct from p_run or p_receipt->>'actId' is distinct from 'Xb8osYTtOjlsgI6k9' then raise exception 'SYNC_INCREMENTAL_RUN_IDENTITY_CHANGED';end if;
 if exists(select 1 from public.review_sync_jobs where id=p_job and incremental_version is not null)
  and p_receipt->>'buildId' is distinct from 'Wck4NsSOTMrHCVoAk' then raise exception 'SYNC_INCREMENTAL_BUILD_MISMATCH';end if;
 update public.review_sync_jobs set incremental_receipt=p_receipt,incremental_received=coalesce(p_received,incremental_received),reviews_fetched=greatest(reviews_fetched,coalesce(p_received,0))
 where id=p_job and status='running' and locked_by=left(p_worker,120) and lease_until>clock_timestamp() and apify_run_id=p_run;
 return found;
end$$;

create function public.commit_incremental_review_sync(p_job uuid,p_worker text,p_bundle jsonb,p_result jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare j public.review_sync_jobs;e public.establishments;target uuid;old_ids uuid[];after_ids uuid[];added integer;removed integer;known integer;ingested jsonb;answer jsonb;head_at timestamptz;head_id text;place jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select establishment_id into target from public.review_sync_jobs where id=p_job;
 if target is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('recent-text-corpus:'||target::text,0));
 select * into e from public.establishments where id=target for update;
 select * into j from public.review_sync_jobs where id=p_job for update;
 if e.id is null or e.organization_id is distinct from j.organization_id then raise exception 'SYNC_INCREMENTAL_OBSOLETE';end if;
 if j.apify_run_id is distinct from p_result->>'run_id' or j.apify_dataset_id is distinct from p_result->>'dataset_id' then raise exception 'SYNC_INCREMENTAL_RUN_IDENTITY_CHANGED';end if;
 if j.status='completed' and j.incremental_result is not null then return j.incremental_result;end if;
 if j.status<>'running' or j.locked_by is distinct from left(p_worker,120) or j.lease_until<=clock_timestamp() then return null;end if;
 if j.incremental_receipt->>'status' is distinct from 'SUCCEEDED' or j.incremental_receipt->>'id' is distinct from j.apify_run_id then raise exception 'SYNC_INCREMENTAL_RUN_NOT_SUCCESSFUL';end if;
 if j.checkpoint_review_at is null or j.checkpoint_review_id is null then raise exception 'SYNC_INCREMENTAL_CHECKPOINT_MISSING';end if;
 if (j.checkpoint_review_id,j.checkpoint_review_at) is distinct from (e.last_review_id,e.last_review_at)
  or j.incremental_identity is not null and (j.incremental_identity->>'google_id',j.incremental_identity->>'place_id') is distinct from (e.google_id,e.place_id)
  or e.review_reload_barrier_at is not null and coalesce(j.provider_start_attempted_at,j.started_at,j.created_at)<e.review_reload_barrier_at then raise exception 'SYNC_INCREMENTAL_OBSOLETE';end if;
 if exists(select 1 from public.review_corpus_policy where paused or ingestions_paused or not enabled) then raise exception 'RETENTION_INGESTION_PAUSED';end if;
 if exists(select 1 from public.initial_import_jobs where establishment_id=e.id and status in('queued','running','retry')) then raise exception 'SYNC_INCREMENTAL_RELOAD_IN_PROGRESS';end if;
 if jsonb_typeof(p_bundle) is distinct from 'array' or jsonb_array_length(p_bundle)>150
  or (p_result->>'since')::timestamptz is distinct from j.checkpoint_review_at-interval '5 seconds'
  or coalesce((p_result->>'received')::integer,-1)<0 or coalesce((p_result->>'unique')::integer,-1)<0
  or (p_result->>'unique')::integer>(p_result->>'received')::integer
  or j.incremental_received is distinct from (p_result->>'received')::integer
  or jsonb_array_length(p_result->'external_ids') is distinct from (p_result->>'unique')::integer
  or exists(select 1 from jsonb_array_elements(p_bundle) x where (x#>>'{row,published_at}')::timestamptz<j.checkpoint_review_at-interval '5 seconds'
   or not (p_result->'external_ids' ? (x#>>'{row,external_review_id}'))) then raise exception 'SYNC_INCREMENTAL_RESULT_INVALID';end if;
 if j.incremental_version is not null and (j.incremental_version<>'google-reviews-incremental-v1' or j.incremental_input->>'reviewsStartDate' is distinct from p_result->>'since') then raise exception 'SYNC_INCREMENTAL_INPUT_MISMATCH';end if;
 if (p_result->>'received')::integer>=150 and (j.incremental_version is not null or coalesce((p_result->>'outside_window')::integer,0)=0) then raise exception 'SYNC_INCREMENTAL_LIMIT_REACHED';end if;
 select coalesce(array_agg(id),'{}') into old_ids from public.reviews where establishment_id=e.id;
 select count(*) into known from (select distinct btrim(value) external_id from jsonb_array_elements_text(p_result->'external_ids')) ids
 where exists(select 1 from public.reviews where establishment_id=e.id and external_review_id=ids.external_id)
  or exists(select 1 from private.review_seen_keys where establishment_id=e.id and external_key_sha256=encode(extensions.digest(ids.external_id,'sha256'),'hex'));
 select coalesce(jsonb_agg(value),'[]') into p_bundle from jsonb_array_elements(p_bundle) x(value)
 where not exists(select 1 from public.reviews where establishment_id=e.id and external_review_id=btrim(value#>>'{row,external_review_id}'))
  and not exists(select 1 from private.review_seen_keys where establishment_id=e.id and external_key_sha256=encode(extensions.digest(btrim(value#>>'{row,external_review_id}'),'sha256'),'hex'));
 if jsonb_array_length(p_bundle)>0 then
  -- All known IDs were removed under the same corpus lock used by ingestion/reload.
  -- The existing manual ingestion function therefore receives only genuinely new rows.
  ingested=public.ingest_recent_reviews(e.id,e.organization_id,p_bundle,'apify');
 end if;
 select coalesce(array_agg(id),'{}') into after_ids from public.reviews where establishment_id=e.id;
 select count(*) into added from unnest(after_ids) id where not(id=any(old_ids));
 select count(*) into removed from unnest(old_ids) id where not(id=any(after_ids));
 -- Use actual retained publication dates. An edited known review cannot move the watermark.
 select external_review_id,published_at into head_id,head_at from public.reviews
 where establishment_id=e.id and published_at>=j.checkpoint_review_at
 order by published_at desc,(external_review_id=j.checkpoint_review_id) desc,external_review_id collate "C",id limit 1;
 if head_at is null then raise exception 'SYNC_INCREMENTAL_HEAD_NOT_SAVED';end if;
 -- A zero-novelty run changes only verification/queue metadata: no retention, snapshot or report rewrite.
 if added>0 then
  place=p_result->'place';
  insert into public.establishment_snapshots(establishment_id,organization_id,captured_at,rating,total_reviews,provider,source_run_id,raw_place_payload)
  values(e.id,e.organization_id,clock_timestamp(),(place->>'rating')::numeric,(place->>'totalReviews')::integer,'apify','sync:'||j.id||':'||j.apify_run_id,coalesce(place->'rawPlacePayload','{}'))
  on conflict(establishment_id,provider,source_run_id) do nothing;
 end if;
 answer=jsonb_build_object('version','google-reviews-incremental-v1','received',(p_result->>'received')::integer,'unique',(p_result->>'unique')::integer,'already_known',known,'outside_window',(p_result->>'outside_window')::integer,'added',added,'removed',removed,'retained',cardinality(after_ids),'since',p_result->>'since','head_id',head_id,'head_at',head_at,'legacy_reused',coalesce((p_result->>'legacy_reused')::boolean,false),'empty',coalesce((p_result->>'empty')::boolean,false));
 update public.review_sync_jobs set head_review_id=head_id,head_review_at=head_at,reviews_fetched=greatest(reviews_fetched,(p_result->>'received')::integer),reviews_inserted=greatest(reviews_inserted,added),incremental_result=answer where id=j.id;
 if public.complete_review_sync_job(j.id,p_worker,clock_timestamp()) is distinct from true then raise exception 'SYNC_LEASE_LOST';end if;
 return answer;
end$$;
revoke all on function public.reserve_incremental_review_sync(uuid,text,jsonb,text),public.observe_incremental_review_sync(uuid,text,text,jsonb,integer),public.commit_incremental_review_sync(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_incremental_review_sync(uuid,text,jsonb,text),public.observe_incremental_review_sync(uuid,text,text,jsonb,integer),public.commit_incremental_review_sync(uuid,text,jsonb,jsonb) to service_role;
commit;
