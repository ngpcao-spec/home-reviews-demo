-- Exact original schema 20261023095555; read-only recovery, no experiment records.
-- Isolated, service-only experimental ledger. No application table is changed.
create table private.nha_trang_jev_batch_experiment (
 id boolean primary key default true check(id), armed_at timestamptz, expires_at timestamptz,
 manifest_sha256 text not null, source_run_id uuid not null,
 created_at timestamptz not null default clock_timestamp(), spending_authorization text not null
);
create table private.nha_trang_jev_batch_specs (
 batch integer primary key check(batch between 1 and 11), reviews integer not null check(reviews=case when batch=11 then 27 else 50 end),
 request_wire text not null, request_sha256 text not null unique,
 mapping jsonb not null, preflight jsonb not null,
 check(request_sha256=encode(extensions.digest(request_wire,'sha256'),'hex')),
 check(request_wire::jsonb->>'model'='jev-1.13.0'), check((preflight->>'passed')::boolean),
 check(jsonb_typeof(mapping)='object')
);
create table private.nha_trang_jev_batch_attempts (
 batch integer primary key references private.nha_trang_jev_batch_specs(batch),
 request_sha256 text not null, reserved_at timestamptz not null default clock_timestamp(),
 attempt integer not null default 1 check(attempt=1)
);
create table private.nha_trang_jev_batch_receipts (
 batch integer primary key references private.nha_trang_jev_batch_attempts(batch),
 body jsonb not null, sha256 text not null,
 saved_at timestamptz not null default clock_timestamp(),
 check(sha256=public.jls_restaurant_hash(body))
);
alter table private.nha_trang_jev_batch_experiment enable row level security;
alter table private.nha_trang_jev_batch_specs enable row level security;
alter table private.nha_trang_jev_batch_attempts enable row level security;
alter table private.nha_trang_jev_batch_receipts enable row level security;
revoke all on private.nha_trang_jev_batch_experiment,private.nha_trang_jev_batch_specs,
 private.nha_trang_jev_batch_attempts,private.nha_trang_jev_batch_receipts from public,anon,authenticated;
grant select on private.nha_trang_jev_batch_experiment,private.nha_trang_jev_batch_specs,
 private.nha_trang_jev_batch_attempts,private.nha_trang_jev_batch_receipts to service_role;
grant insert on private.nha_trang_jev_batch_attempts,private.nha_trang_jev_batch_receipts to service_role;

create function public.nha_trang_jev_batch_claim(p_batch integer) returns jsonb
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
 if p_batch<>(select min(batch)from private.nha_trang_jev_batch_specs s where not exists(select 1 from private.nha_trang_jev_batch_attempts a where a.batch=s.batch))then raise exception 'BATCH_ORDER_CHANGED';end if;
 select * into strict s from private.nha_trang_jev_batch_specs where batch=p_batch;
 insert into private.nha_trang_jev_batch_attempts(batch,request_sha256)values(s.batch,s.request_sha256);
 return jsonb_build_object('claimed',true,'batch',s.batch,'request_wire',s.request_wire,'request_sha256',s.request_sha256,'mapping',s.mapping,'preflight',s.preflight,'reviews',s.reviews);
end $$;
create function public.nha_trang_jev_batch_wake(p_batch integer,p_mode text default 'execute') returns bigint
language plpgsql security invoker set search_path='' as $$
declare result bigint;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_mode not in('probe','execute')or p_batch not between 1 and 11 then raise exception 'EXPERIMENT_SCOPE';end if;
 select net.http_post(url:='https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/experiment-nha-trang-jev-batches',
 headers:=jsonb_build_object('Content-Type','application/json','x-home-reviews-scheduler',(select decrypted_secret from vault.decrypted_secrets where name='home_reviews_scheduler_token')),
 body:=jsonb_build_object('mode',p_mode,'batch',p_batch),timeout_milliseconds:=10000)into result;
 return result;
end $$;
-- Only the server can persist a receipt. Database-write replay is idempotent;
-- it never reopens an attempt or performs the provider request again.
create function public.nha_trang_jev_batch_save(p_batch integer,p_body jsonb,p_sha text,p_continue boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a private.nha_trang_jev_batch_attempts;r private.nha_trang_jev_batch_receipts;next_request bigint;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into strict a from private.nha_trang_jev_batch_attempts where batch=p_batch;
 if public.jls_restaurant_hash(p_body)<>p_sha or p_body->>'request_sha256'<>a.request_sha256 or(p_body->>'batch')::integer<>p_batch or(p_body->>'attempt')::integer<>1 then raise exception 'RECEIPT_CHANGED';end if;
 insert into private.nha_trang_jev_batch_receipts(batch,body,sha256)values(p_batch,p_body,p_sha)on conflict do nothing;
 select * into strict r from private.nha_trang_jev_batch_receipts where batch=p_batch;
 if r.sha256<>p_sha then raise exception 'RECEIPT_IMMUTABLE';end if;
 if p_continue and p_batch<11 and(p_body->>'http_status')::integer=200 and p_body->>'error' is null then
  next_request=public.nha_trang_jev_batch_wake(p_batch+1);
 end if;
 return jsonb_build_object('saved',true,'next_request_id',next_request);
end $$;
revoke all on function public.nha_trang_jev_batch_claim(integer),public.nha_trang_jev_batch_wake(integer,text),public.nha_trang_jev_batch_save(integer,jsonb,text,boolean)from public,anon,authenticated;
grant execute on function public.nha_trang_jev_batch_claim(integer),public.nha_trang_jev_batch_wake(integer,text),public.nha_trang_jev_batch_save(integer,jsonb,text,boolean)to service_role;


