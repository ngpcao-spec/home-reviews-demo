-- Retired clients and legacy enqueue RPCs cannot create an unfrozen source and
-- reach a paid worker after the transition. Receipt checkpoints remain valid.
create function private.retention_source_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.review_corpus_policy;begin
 if current_setting('home.retention_maintenance',true)='on' then return new;end if;
 select * into p from public.review_corpus_policy where id for share;
 if p.enabled and (new.snapshot#>>'{retention,epoch}' is distinct from p.epoch::text or new.snapshot#>>'{retention,version}' is distinct from p.version) then raise exception 'FROZEN_RECENT_CORPUS_REQUIRED';end if;
 return new;
end $$;
create trigger recent_text_source before insert or update of snapshot on public.historical_report_runs for each row execute function private.retention_source_guard();
revoke all on function private.retention_source_guard() from public,anon,authenticated;

-- Expiration runs even when no ingestion occurs. Existing obsolete cron jobs
-- remain disabled; only current workers are enabled by the controlled rollout.
select cron.schedule('home-reviews-recent-text-retention-v1','* * * * *','select public.maintain_recent_review_corpora()');
