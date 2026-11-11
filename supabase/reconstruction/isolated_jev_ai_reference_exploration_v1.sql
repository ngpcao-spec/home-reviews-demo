-- Exact schema-only production history 20261009011957; read-only recovery 2026-11-11.

create table if not exists public.analysis_negative_ai_exploratory_runs (
 id uuid primary key default gen_random_uuid(),
 source_experiment_id uuid not null unique references public.analysis_negative_validation_runs(id) on delete restrict,
 methodology text not null default 'exploratory_ai_reference_not_human_gold'
   check (methodology='exploratory_ai_reference_not_human_gold'),
 status text not null default 'prepared' check(status in ('prepared','queued','running','completed','failed')),
 requested_model text not null default 'jev-latest',
 expected_tasks integer not null default 192 check (expected_tasks=192),
 input_rate_usd_per_million numeric not null default 0.042,
 status_note text not null default 'Exploratory AI preannotations; not independent human ground truth',
 lease_owner uuid,
 lease_until timestamptz,
 started_at timestamptz,
 completed_at timestamptz,
 last_tick_at timestamptz,
 error_code text,
 created_at timestamptz not null default now()
);
create table if not exists public.analysis_negative_ai_exploratory_tasks (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references public.analysis_negative_ai_exploratory_runs(id) on delete cascade,
 experiment_id uuid not null,
 review_id uuid not null,
 analysis_text_sha256 text not null check(analysis_text_sha256 ~ '^[a-f0-9]{64}$'),
 model_version text not null check(model_version in('v9','v11')),
 review_alias text not null,
 question_set_version text not null,
 repeat integer not null check(repeat between 1 and 3),
 status text not null default 'pending' check(status in('pending','running','completed','failed')),
 response jsonb,
 served_model text,
 input_tokens bigint not null default 0,
 output_tokens bigint not null default 0,
 request_count integer not null default 0,
 retry_count integer not null default 0,
 cost_usd double precision not null default 0,
 duration_ms bigint not null default 0,
 error_code text,
 usage_complete boolean not null default true,
 started_at timestamptz,
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 unique (run_id,review_id,model_version,repeat),
 foreign key (experiment_id,review_id)
   references public.analysis_negative_validation_ai_preannotations(experiment_id,review_id) on delete restrict
);
create index if not exists analysis_negative_ai_exploratory_tasks_pending_idx
 on public.analysis_negative_ai_exploratory_tasks(run_id,status,model_version,repeat);
create table if not exists public.analysis_negative_ai_exploratory_results (
 run_id uuid primary key references public.analysis_negative_ai_exploratory_runs(id) on delete cascade,
 comparison jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.analysis_negative_ai_exploratory_runs enable row level security;
alter table public.analysis_negative_ai_exploratory_tasks enable row level security;
alter table public.analysis_negative_ai_exploratory_results enable row level security;
comment on table public.analysis_negative_ai_exploratory_runs is 'Standalone AI-reference exploration: MUST NOT be used as human Gold or production JEV scoring';
comment on table public.analysis_negative_ai_exploratory_results is 'Exploratory comparison against ChatGPT AI labels, not measured human accuracy.';
create or replace function public.claim_negative_ai_exploratory_run(p_worker uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare selected public.analysis_negative_ai_exploratory_runs%rowtype;
begin
  select * into selected from public.analysis_negative_ai_exploratory_runs
   where status='queued' or (status='running' and lease_until < now())
   order by created_at
   for update skip locked limit 1;
  if not found then return null;end if;
  update public.analysis_negative_ai_exploratory_runs
   set status='running',lease_owner=p_worker,lease_until=now()+interval '3 minutes',
       started_at=coalesce(started_at,now()),last_tick_at=now()
   where id=selected.id returning * into selected;
  return to_jsonb(selected);
end $$;
revoke all on function public.claim_negative_ai_exploratory_run(uuid) from public,anon,authenticated;
grant execute on function public.claim_negative_ai_exploratory_run(uuid) to service_role;
create or replace function public.finish_negative_ai_exploratory_tick(
 p_run_id uuid,p_worker uuid,p_status text,p_error text default null
)
returns boolean
language plpgsql security definer set search_path=public as $$
begin
  if p_status not in ('queued','completed','failed') then raise exception 'INVALID_STATUS'; end if;
  update public.analysis_negative_ai_exploratory_runs
   set status=p_status,error_code=p_error,lease_owner=null,lease_until=null,
      last_tick_at=now(),
      completed_at=case when p_status in ('completed','failed') then now() else completed_at end
   where id=p_run_id and status='running' and lease_owner=p_worker
     and lease_until>now();
  return found;
end $$;
revoke all on function public.finish_negative_ai_exploratory_tick(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.finish_negative_ai_exploratory_tick(uuid,uuid,text,text) to service_role;


