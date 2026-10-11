create or replace function public.hybrid_job_attempt_guard() returns trigger language plpgsql set search_path='' as $$begin
 if old.status in('completed','invalid_output','cancelled') then raise exception 'HYBRID_JOB_IMMUTABLE';end if;
 if old.request_count=1 and (new.status='queued' or new.status='running' and (old.status<>'running' or old.lease_owner is distinct from new.lease_owner or old.lease_until<now())) then raise exception 'HYBRID_NO_PAID_RETRY';end if;
 if new.request_count<old.request_count then raise exception 'HYBRID_ATTEMPT_COUNTER_IMMUTABLE';end if;
 if new.plan_id<>old.plan_id or new.organization_id<>old.organization_id or new.authorization_id<>old.authorization_id or new.dossier_sha256<>old.dossier_sha256 or new.prompt_sha256<>old.prompt_sha256 or new.schema_sha256<>old.schema_sha256 then raise exception 'HYBRID_JOB_SCOPE_IMMUTABLE';end if;return new;end $$;
