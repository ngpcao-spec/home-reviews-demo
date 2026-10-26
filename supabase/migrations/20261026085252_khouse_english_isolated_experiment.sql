-- No production table, trigger, queue, setting, cron or publication is changed.
create table private.kh_en_experiments(
 id uuid primary key,reference_report_id uuid not null,establishment_id uuid not null,
 armed boolean not null default false,created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,body jsonb not null,artifacts jsonb not null default '{}'
);
create table private.kh_en_calls(
 experiment_id uuid not null references private.kh_en_experiments(id),
 phase text not null check(phase in('apify','jev_1','jev_2','jev_3','sol')),
 request_wire text not null,request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
 state text not null default 'prepared' check(state in('prepared','reserved','received','unknown')),
 attempts integer not null default 0 check(attempts between 0 and 1),worker uuid,
 reserved_at timestamptz,finished_at timestamptz,receipt jsonb,
 primary key(experiment_id,phase)
);
alter table private.kh_en_experiments enable row level security;
alter table private.kh_en_calls enable row level security;
revoke all on private.kh_en_experiments,private.kh_en_calls from public,anon,authenticated,service_role;

create function public.kh_en_read(p_id uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('experiment',to_jsonb(e),'calls',coalesce((select jsonb_agg(c order by phase) from private.kh_en_calls c where experiment_id=e.id),'[]')) from private.kh_en_experiments e where id=p_id
$$;
create function public.kh_en_claim(p_id uuid,p_phase text,p_worker uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.kh_en_experiments;c private.kh_en_calls;begin
 select * into e from private.kh_en_experiments where id=p_id for share;
 if not found or not e.armed or e.expires_at<=clock_timestamp() then return null;end if;
 if p_phase like 'jev_%' and coalesce(e.artifacts#>>'{coverage,complete}','false')<>'true' then raise exception 'EXPERIMENT_COVERAGE_REQUIRED';end if;
 if p_phase='sol' and (coalesce(e.artifacts->>'analysis_ready','false')<>'true' or (select count(*) from private.kh_en_calls where experiment_id=p_id and phase like 'jev_%' and state='received' and receipt->>'http_status'='200')<>3) then raise exception 'EXPERIMENT_THREE_JEV_RECEIPTS_REQUIRED';end if;
 update private.kh_en_calls set state='reserved',attempts=1,worker=p_worker,reserved_at=clock_timestamp()
 where experiment_id=p_id and phase=p_phase and state='prepared' and attempts=0
 and request_sha256=encode(extensions.digest(request_wire,'sha256'),'hex') returning * into c;
 if not found then return null;end if;return to_jsonb(c);
end$$;
create function public.kh_en_receive(p_id uuid,p_phase text,p_worker uuid,p_receipt jsonb) returns boolean language sql security definer set search_path='' as $$
 with saved as(update private.kh_en_calls set state=case when p_receipt->>'raw_response_text' is null then 'unknown' else 'received' end,receipt=p_receipt,finished_at=clock_timestamp()
 where experiment_id=p_id and phase=p_phase and worker=p_worker and state='reserved' and attempts=1 and p_receipt->>'request_sha256'=request_sha256 returning 1)select exists(select 1 from saved)
$$;
create function public.kh_en_artifact(p_id uuid,p_key text,p_value jsonb) returns boolean language sql security definer set search_path='' as $$
 with saved as(update private.kh_en_experiments set artifacts=jsonb_set(artifacts,array[p_key],p_value,true)
 where id=p_id and armed and expires_at>clock_timestamp() and p_key in('apify_status','apify_dataset') returning 1)select exists(select 1 from saved)
$$;
revoke all on function public.kh_en_read(uuid),public.kh_en_claim(uuid,text,uuid),public.kh_en_receive(uuid,text,uuid,jsonb),public.kh_en_artifact(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.kh_en_read(uuid),public.kh_en_claim(uuid,text,uuid),public.kh_en_receive(uuid,text,uuid,jsonb),public.kh_en_artifact(uuid,text,jsonb) to service_role;
