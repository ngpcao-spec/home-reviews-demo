begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.reviews in access exclusive mode nowait;

-- Attention is a UI/business flag, not authorization to dispatch automatic AI.
-- Keep the existing live-review rule and allow explicitly historical rows to
-- retain attention at 1--3 stars with their automatic-AI flag disabled.
do $$begin
 if coalesce((select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.reviews'::regclass and conname='reviews_attention_rule'),'') not in(
  'CHECK (((((rating >= 1) AND (rating <= 3)) AND requires_attention AND requires_ai_analysis) OR ((rating = ANY (ARRAY[4, 5])) AND (NOT requires_attention) AND (NOT requires_ai_analysis))))',
  'CHECK ((((rating >= 1) AND (rating <= 3) AND requires_attention AND requires_ai_analysis) OR ((rating = ANY (ARRAY[4, 5])) AND (NOT requires_attention) AND (NOT requires_ai_analysis))))') then
  raise exception 'REVIEWS_ATTENTION_RULE_DEFINITION_CHANGED';end if;
end$$;
alter table public.reviews drop constraint reviews_attention_rule;
alter table public.reviews add constraint reviews_attention_rule check(
 (rating between 1 and 3 and requires_attention and (requires_ai_analysis or historical_import))
 or (rating in(4,5) and not requires_attention and not requires_ai_analysis)
);

-- Keep a content-free marker so even a zero-review validated stage cannot be
-- confused with a collection that has never reached staging after its TTL.
do $$declare d text;a text;begin
 d:=pg_get_functiondef('public.stage_review_reload(uuid,text,jsonb,jsonb)'::regprocedure);
 a:=' update public.initial_import_jobs set reviews_fetched=n where id=j.id;';
 if position(a in d)=0 then raise exception 'RELOAD_STAGE_DEFINITION_CHANGED';end if;
 execute replace(d,a,$patch$
 update public.initial_import_jobs set reviews_fetched=n,result=coalesce(result,'{}'::jsonb)||jsonb_build_object(
  'validated_stage',jsonb_build_object('sha256',v_sha,'created_at',(select created_at from private.review_reload_staging where job_id=j.id))) where id=j.id;
$patch$);
 d:=pg_get_functiondef('public.fail_review_reload(uuid,text,text,jsonb)'::regprocedure);
 a:='result=jsonb_build_object(''validation'',p_summary)';
 if position(a in d)=0 then raise exception 'RELOAD_FAILURE_DEFINITION_CHANGED';end if;
 execute replace(d,a,'result=coalesce(result,''{}''::jsonb)||jsonb_build_object(''validation'',p_summary)');
end$$;

-- A manual Retry may commit a still-valid staged batch. Once it expires, do not
-- fall through to a provider GET/POST or silently start a different collection.
create or replace function public.review_reload_stage_ready(p_job uuid,p_worker text) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.initial_import_jobs;s private.review_reload_staging;begin
 select * into j from public.initial_import_jobs where id=p_job and request_kind='reload' and status='running'
  and locked_by=p_worker and lease_until>now();
 if not found then raise exception 'INITIAL_IMPORT_LEASE_LOST';end if;
 select * into s from private.review_reload_staging where job_id=j.id;
 if found then
  if s.created_at<=now()-interval '24 hours' then raise exception 'RELOAD_VALIDATED_STAGE_EXPIRED';end if;
  return true;
 end if;
 -- reviews_fetched/persistence_started_at cover validated stages created before
 -- this migration, without modifying or resuming any existing job on deploy.
 if j.result ? 'validated_stage' or j.reviews_fetched>0 or j.persistence_started_at is not null then
  raise exception 'RELOAD_VALIDATED_STAGE_EXPIRED';end if;
 return false;
end$$;
revoke all on function public.review_reload_stage_ready(uuid,text) from public,anon,authenticated;
grant execute on function public.review_reload_stage_ready(uuid,text) to service_role;

do $$declare d text;a text;begin
 d:=pg_get_functiondef('public.request_review_reload(uuid,uuid)'::regprocedure);
 a:='  perform private.assert_review_reload_idle(e.id);';
 if position(a in d)=0 then raise exception 'RELOAD_RETRY_DEFINITION_CHANGED';end if;
 execute replace(d,a,a||$patch$
  if exists(select 1 from private.review_reload_staging where job_id=j.id and created_at<=now()-interval '24 hours')
   or not exists(select 1 from private.review_reload_staging where job_id=j.id)
    and (j.result ? 'validated_stage' or j.reviews_fetched>0 or j.persistence_started_at is not null) then
   raise exception 'RELOAD_VALIDATED_STAGE_EXPIRED';end if;
$patch$);
 d:=pg_get_functiondef('public.apply_review_reload(uuid,text)'::regprocedure);
 a:=' select * into s from private.review_reload_staging where job_id=j.id;';
 if position(a in d)=0 then raise exception 'RELOAD_APPLY_DEFINITION_CHANGED';end if;
 execute replace(d,a,a||$patch$
 if found and s.created_at<=now()-interval '24 hours' then raise exception 'RELOAD_VALIDATED_STAGE_EXPIRED';end if;
$patch$);
end$$;

-- No UPDATE of review/job data, dispatch, requeue or actual replacement here.
notify pgrst,'reload schema';
commit;
