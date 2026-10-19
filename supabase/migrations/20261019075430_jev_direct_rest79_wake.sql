-- Additive experimental wake only. No consent, run, attempt, cron or provider call is created by this DDL.
create function public.wake_jev_direct_rest79(p_execution uuid) returns bigint
language plpgsql security invoker set search_path='' as $fn$
declare e public.analysis_jls_snapshot_preparations;n bigint;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into e from public.analysis_jls_snapshot_preparations where id=p_execution;
 if e.kind is distinct from 'jev_direct_categories4_rest79_execution_v1'
 or e.sha256 is distinct from public.jls_restaurant_hash(e.body)
 or e.body->>'executor_version' is distinct from 'jev-direct-categories4-rest79-executor-v1'
 or e.body->>'consent_source' is distinct from 'user_directive_codex_delegation'
 or e.body->'scope'->>'max_new_jev_calls' is distinct from '79'
 or e.body->'scope'->>'max_attempts_per_review' is distinct from '1'
 or e.body->'scope'->>'automatic_retry' is distinct from 'false'
 or e.body->'scope'->>'source_preparation_id' is distinct from 'f858bb8f-395d-4aa9-bd10-d7f641934244'
 or (e.body->>'expires_at')::timestamptz<=now()
 or e.body->>'directive_sha256' is distinct from encode(extensions.digest(e.body->>'directive','sha256'),'hex')
 then raise exception 'REST79_GO_INVALID';end if;
 if exists(select 1 from public.analysis_jls_snapshot_preparations where protocol_id=e.protocol_id and kind='jev_direct_categories4_rest79_dataset_v1') then return null;end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/process-jev-direct-rest79',
  headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',
   (select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
  body:=jsonb_build_object('execution_id',e.id),timeout_milliseconds:=10000) into n;
 return n;
end $fn$;
revoke all on function public.wake_jev_direct_rest79(uuid) from public,anon,authenticated;
grant execute on function public.wake_jev_direct_rest79(uuid) to service_role;
