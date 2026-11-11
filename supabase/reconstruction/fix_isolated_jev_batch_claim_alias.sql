-- Exact original schema 20261023095730; read-only recovery, no experiment records.
create or replace function public.nha_trang_jev_batch_claim(p_batch integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e private.nha_trang_jev_batch_experiment;s private.nha_trang_jev_batch_specs;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 perform pg_advisory_xact_lock(hashtextextended('nha-trang-jev-11-batches-20261023',0));
 select * into e from private.nha_trang_jev_batch_experiment where id=true;
 if e.armed_at is null or e.expires_at<=clock_timestamp() then return jsonb_build_object('claimed',false,'reason','DISARMED_OR_EXPIRED');end if;
 if exists(select 1 from private.nha_trang_jev_batch_attempts where batch=p_batch) then return jsonb_build_object('claimed',false,'reason','ALREADY_RESERVED_NO_RETRY');end if;
 if exists(select 1 from private.nha_trang_jev_batch_attempts a where not exists(select 1 from private.nha_trang_jev_batch_receipts r where r.batch=a.batch)) then return jsonb_build_object('claimed',false,'reason','OTHER_BATCH_OUTCOME_PENDING');end if;
 if (select count(*) from private.nha_trang_jev_batch_specs)<>11 or (select sum(reviews)from private.nha_trang_jev_batch_specs)<>527 then raise exception 'EXPERIMENT_NOT_PREPARED';end if;
 if not exists(select 1 from public.analysis_jls_restaurant_runs where id=e.source_run_id and status='completed')then raise exception 'REFERENCE_CHANGED';end if;
 if p_batch<>(select min(candidate.batch)from private.nha_trang_jev_batch_specs candidate where not exists(select 1 from private.nha_trang_jev_batch_attempts previous where previous.batch=candidate.batch))then raise exception 'BATCH_ORDER_CHANGED';end if;
 select * into strict s from private.nha_trang_jev_batch_specs where batch=p_batch;
 insert into private.nha_trang_jev_batch_attempts(batch,request_sha256)values(s.batch,s.request_sha256);
 return jsonb_build_object('claimed',true,'batch',s.batch,'request_wire',s.request_wire,'request_sha256',s.request_sha256,'mapping',s.mapping,'preflight',s.preflight,'reviews',s.reviews);
end $$;

