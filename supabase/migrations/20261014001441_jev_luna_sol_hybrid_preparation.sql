-- Free, independent preparation. No consent, dispatch, cron, job or provider call is created.
create table public.analysis_jev_luna_sol_plans (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 establishment_id uuid not null references public.establishments(id), source_plan_id uuid not null references public.analysis_jev_hybrid_plans(id),
 source_snapshot_id uuid not null references public.analysis_jev_pilot_snapshots(id),
 version text not null check(version='jev-luna-sol-hybrid-v1'), language text not null check(language in('fr','vi')),
 body jsonb not null, result_sha256 text not null check(result_sha256~'^[a-f0-9]{64}$'),
 config_sha256 text not null, dossier_sha256 text not null, statistics_sha256 text not null,
 max_luna_calls int not null check(max_luna_calls between 1 and 32), question_count int not null check(question_count between 1 and 32),
 paid_enabled boolean not null default false check(not paid_enabled), production_enabled boolean not null default false check(not production_enabled),
 preparation_provenance text not null default 'authenticated_admin_free_preparation' check(preparation_provenance='authenticated_admin_free_preparation'),
 created_at timestamptz not null default now(), unique(id,organization_id), unique(source_plan_id,language,result_sha256)
);
create table public.analysis_jev_luna_sol_runs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), plan_id uuid not null unique,
 foreign key(plan_id,organization_id) references public.analysis_jev_luna_sol_plans(id,organization_id),
 status text not null default 'blocked' check(status in('blocked','queued','running','completed','failed','billing_uncertain')),
 consent_source text check(consent_source in('manual_cost_confirmation','user_directive_codex_delegation')),
 consent_record jsonb, consent_sha256 text, authorized_identity uuid references auth.users(id), expires_at timestamptz,
 max_luna_calls int not null check(max_luna_calls between 1 and 32), max_sol_calls int not null default 1 check(max_sol_calls=1),
 automatic_retry boolean not null default false check(not automatic_retry), created_at timestamptz not null default now(),
 unique(id,organization_id)
);
create table public.analysis_jev_luna_sol_tasks (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), run_id uuid not null,
 foreign key(run_id,organization_id) references public.analysis_jev_luna_sol_runs(id,organization_id),
 phase text not null check(phase in('luna','sol')), task_key text not null, review_id uuid references public.reviews(id),
 status text not null default 'blocked' check(status in('blocked','queued','running','completed','failed','billing_uncertain','invalid_output','cancelled')),
 request_count int not null default 0 check(request_count between 0 and 1), automatic_retry boolean not null default false check(not automatic_retry),
 request jsonb not null, request_sha256 text not null, response jsonb, response_sha256 text,
 requested_model text not null, served_model text, input_tokens bigint, output_tokens bigint, cost_usd numeric,
 duration_ms bigint, error_code text, response_id text, lease_owner text, lease_until timestamptz,
 created_at timestamptz not null default now(), completed_at timestamptz,
 unique(run_id,phase,task_key), unique(id,organization_id),
 check((phase='luna' and requested_model='gpt-6-luna' and review_id is not null) or (phase='sol' and requested_model='gpt-6.1-sol' and review_id is null))
);
create unique index jls_one_sol_task on public.analysis_jev_luna_sol_tasks(run_id) where phase='sol';
create unique index jls_one_luna_review on public.analysis_jev_luna_sol_tasks(run_id,review_id) where phase='luna';
create table public.analysis_jev_luna_sol_verdicts (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), task_id uuid not null,
 foreign key(task_id,organization_id) references public.analysis_jev_luna_sol_tasks(id,organization_id),
 evidence_id text not null, body jsonb not null, result_sha256 text not null, status text not null check(status in('ACCEPTED','REJECTED','UNCERTAIN')),
 human_validated boolean not null default false check(not human_validated), created_at timestamptz not null default now(), unique(task_id,evidence_id)
);
create table public.analysis_jev_luna_sol_results (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), run_id uuid not null unique,
 foreign key(run_id,organization_id) references public.analysis_jev_luna_sol_runs(id,organization_id),
 body jsonb not null, result_sha256 text not null, human_validated boolean not null default false check(not human_validated), created_at timestamptz not null default now()
);
create table public.analysis_jev_luna_sol_events (
 id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id), plan_id uuid not null,
 foreign key(plan_id,organization_id) references public.analysis_jev_luna_sol_plans(id,organization_id),
 action text not null, payload jsonb not null default '{}', created_at timestamptz not null default now()
);
do $$declare t text;begin
 foreach t in array array['plans','runs','tasks','verdicts','results','events'] loop
  execute format('alter table public.analysis_jev_luna_sol_%I enable row level security',t);
  execute format('revoke all on public.analysis_jev_luna_sol_%I from anon,authenticated',t);
  execute format('grant select on public.analysis_jev_luna_sol_%I to authenticated',t);
  execute format('grant all on public.analysis_jev_luna_sol_%I to service_role',t);
  execute format('create policy jls_org_read on public.analysis_jev_luna_sol_%I for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=analysis_jev_luna_sol_%I.organization_id and m.user_id=(select auth.uid()) and m.role in(''owner'',''admin'',''manager'')))',t,t);
  execute format('create index on public.analysis_jev_luna_sol_%I(organization_id)',t);
  if t not in('runs','tasks') then
   execute format('create trigger jls_immutable before update or delete on public.analysis_jev_luna_sol_%I for each row execute function public.pilot_evidence_immutable()',t);
  end if;
 end loop;
end $$;
create index on public.analysis_jev_luna_sol_plans(establishment_id);
create index on public.analysis_jev_luna_sol_plans(source_plan_id);
create index on public.analysis_jev_luna_sol_plans(source_snapshot_id);
create index on public.analysis_jev_luna_sol_tasks(review_id);
create index on public.analysis_jev_luna_sol_runs(authorized_identity);
-- The future transactional reservation/consent workflow is intentionally unbound.
-- Even privileged SQL cannot dispatch or manufacture an authorized running task in this delivery.
create function public.jls_execution_closed() returns trigger language plpgsql security invoker set search_path='' as $$
declare p public.analysis_jev_luna_sol_plans;r public.analysis_jev_luna_sol_runs;begin
 if tg_op='DELETE' then raise exception 'JLS_HISTORY_IMMUTABLE';end if;
 if tg_table_name='analysis_jev_luna_sol_runs' then
  if new.status<>'blocked' or new.consent_record is not null or new.consent_source is not null or new.authorized_identity is not null then raise exception 'JLS_PAID_EXECUTION_DISABLED';end if;
  select * into p from public.analysis_jev_luna_sol_plans where id=new.plan_id and organization_id=new.organization_id;
  if p.id is null or new.max_luna_calls<>p.max_luna_calls then raise exception 'JLS_CALL_LIMIT_CHANGED';end if;
 else
  if new.status<>'blocked' or new.request_count<>0 or new.response is not null then raise exception 'JLS_PAID_EXECUTION_DISABLED';end if;
  select * into r from public.analysis_jev_luna_sol_runs where id=new.run_id and organization_id=new.organization_id;
  select * into p from public.analysis_jev_luna_sol_plans where id=r.plan_id;
  if r.id is null or p.id is null then raise exception 'JLS_SCOPE_CHANGED';end if;
  if new.phase='luna' and (not exists(select 1 from jsonb_array_elements(p.body->'luna_groups') g where g->>'review_id'=new.review_id::text and g->>'request_sha256'=new.request_sha256 and g->'payload'=new.request) or
   (tg_op='INSERT' and (select count(*) from public.analysis_jev_luna_sol_tasks where run_id=new.run_id and phase='luna')>=r.max_luna_calls)) then raise exception 'JLS_CALL_LIMIT_OR_REQUEST_CHANGED';end if;
 end if;
 return new;
end $$;
create trigger jls_execution_closed before insert or update or delete on public.analysis_jev_luna_sol_runs for each row execute function public.jls_execution_closed();
create trigger jls_execution_closed before insert or update or delete on public.analysis_jev_luna_sol_tasks for each row execute function public.jls_execution_closed();
create function public.save_jls_preparation(p_body jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.analysis_jev_hybrid_plans;s public.analysis_jev_pilot_snapshots;pid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jev_hybrid_plans where id=(p_body->>'source_plan_id')::uuid;
 select * into s from public.analysis_jev_pilot_snapshots where id=p.source_snapshot_id;
 if p.id is null or s.id is null or p.version<>'jev-hybrid-evidence-report-v1.1-balanced' or p.organization_id<>s.organization_id or
 not exists(select 1 from public.organization_members m where m.organization_id=s.organization_id and m.user_id=s.created_by and m.role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if p_body->>'version' is distinct from 'jev-luna-sol-hybrid-v1' or p_body->>'source_plan_sha256' is distinct from p.result_sha256 or
 p_body->>'source_snapshot_id' is distinct from s.id::text or p_body->>'source_sha256' is distinct from s.source_sha256 or
 p_body->>'organization_id' is distinct from p.organization_id::text or p_body->>'establishment_id' is distinct from p.establishment_id::text or
 p_body->'statistics' is distinct from p.body->'analytics' or p_body->'selected' is distinct from p.body->'selected' or
 p_body->'cache_fingerprints' is distinct from p.body->'cache_fingerprints' or p_body->>'statistics_sha256' is distinct from p.statistics_sha256 or
 p_body->>'paid_enabled' is distinct from 'false' or p_body->>'production_enabled' is distinct from 'false' or p_body->>'new_paid_calls' is distinct from '0' or
 p_body->'evidence_decisions' is distinct from 'null'::jsonb or p_body->'accepted_sol_dossier' is distinct from 'null'::jsonb or p_body->'sol_response' is distinct from 'null'::jsonb or
 p_body->'config'->>'luna_model' is distinct from 'gpt-6-luna' or p_body->'config'->>'sol_model' is distinct from 'gpt-6.1-sol' or
 p_body->'config'->>'luna_endpoint' is distinct from '/v1/decisions' or p_body->'config'->>'jev_configuration' is distinct from 'v12_economy_1pass_v1' or
 (p_body->'config'->>'confidence_min')::numeric is distinct from 0.60 or p_body->'config'->>'automatic_retry' is distinct from 'false' then raise exception 'JLS_SCOPE_CHANGED';end if;
 if p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body),'sha256'),'hex') or
 p_body->>'config_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body->'config'),'sha256'),'hex') or
 p_body->>'dossier_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body->'selected'),'sha256'),'hex') or
 p_body->>'luna_manifest_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body->'luna_groups'),'sha256'),'hex') or
 p_body->>'prompt_sha256' is distinct from encode(extensions.digest(p_body->'conditional_sol_preview'->>'prompt','sha256'),'hex') or
 p_body->>'schema_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body->'conditional_sol_preview'->'schema'),'sha256'),'hex') then raise exception 'JLS_HASH_CHANGED';end if;
 if p_body->>'conditional_sol_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body->'conditional_sol_preview'->'packet'),'sha256'),'hex') or
 p_body->'conditional_sol_preview'->'packet'->'statistics' is distinct from p_body->'statistics' then raise exception 'JLS_SOL_DOSSIER_CHANGED';end if;
 if (p_body->>'question_count')::int<>jsonb_array_length(p.body->'selected') or (p_body->>'max_luna_calls')::int<>(select count(distinct e->>'review_id') from jsonb_array_elements(p.body->'selected') e) or
 jsonb_array_length(p_body->'luna_groups')<>(p_body->>'max_luna_calls')::int or
 (select count(distinct g->>'review_id') from jsonb_array_elements(p_body->'luna_groups') g)<>(p_body->>'max_luna_calls')::int or
 (select sum(jsonb_array_length(g->'evidence_ids')) from jsonb_array_elements(p_body->'luna_groups') g)<>(p_body->>'question_count')::int then raise exception 'JLS_GROUP_COUNTS_CHANGED';end if;
 if exists(select 1 from jsonb_array_elements(p_body->'luna_groups') g where g->>'request_sha256'<>encode(extensions.digest(public.jev_economy_canonical(g->'payload'),'sha256'),'hex') or
 g->'payload'->>'model'<>'gpt-6-luna' or g->'payload'->>'input' is null or
 not exists(select 1 from jsonb_array_elements(s.source->'reviews') r where r->>'id'=g->>'review_id' and r->>'analysis_language'='en' and r->>'analysis_text_sha256'=g->>'analysis_text_sha256' and
 encode(extensions.digest(r->>'analysis_text','sha256'),'hex')=g->>'analysis_text_sha256' and (g->'payload'->>'input')::jsonb->>'analysis_text'=r->>'analysis_text') or
 (select count(*) from jsonb_object_keys((g->'payload'->>'input')::jsonb))<>2 or not ((g->'payload'->>'input')::jsonb ? 'review_alias') or
 jsonb_array_length(g->'payload'->'questions')<>jsonb_array_length(g->'evidence_ids') or
 g->'evidence_ids' is distinct from (select jsonb_agg(q->'name') from jsonb_array_elements(g->'payload'->'questions') q) or
 g->>'questions_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(g->'payload'->'questions'),'sha256'),'hex') or
 exists(select 1 from jsonb_array_elements(g->'payload'->'questions') q where q->>'type'<>'choice' or not exists(select 1 from jsonb_array_elements(p.body->'selected') e where e->>'evidence_id'=q->>'name' and e->>'review_id'=g->>'review_id'))) then raise exception 'JLS_GROUP_BINDING_CHANGED';end if;
 if exists(select 1 from jsonb_array_elements(p.body->'selected') e where
  (select count(*) from jsonb_array_elements(p_body->'luna_groups') g cross join lateral jsonb_array_elements(g->'payload'->'questions') q where q->>'name'=e->>'evidence_id')<>1) then raise exception 'JLS_DUPLICATE_OR_MISSING_QUESTION';end if;
 if exists(select 1 from jsonb_array_elements(p.body->'cache_fingerprints') f where not exists(select 1 from public.analysis_jev_review_cache c where c.id=(f->>'cache_id')::uuid and c.organization_id=p.organization_id and c.establishment_id=p.establishment_id and c.status='completed' and c.configuration_id='v12_economy_1pass_v1' and c.review_id=(f->>'review_id')::uuid and c.analysis_text_sha256=f->>'text_sha256' and
 c.instruction_version=p_body->'config'->>'source_question_set' and c.instruction_sha256=p_body->'config'->>'source_questions_sha256' and c.threshold_version=p_body->'config'->>'source_threshold_version' and c.threshold_sha256=p_body->'config'->>'source_threshold_sha256' and c.requested_model='jev-latest' and c.served_model=c.expected_served_model and
 (select count(*) from jsonb_object_keys(c.theme_results))=25 and encode(extensions.digest(public.jev_economy_canonical(jsonb_build_object('cache_key',c.cache_key,'response',c.response,'theme_results',c.theme_results,'served_model',c.served_model)),'sha256'),'hex')=f->>'response_sha256')) then raise exception 'JLS_CACHE_CHANGED';end if;
 perform pg_advisory_xact_lock(hashtextextended(p.id::text||':'||(p_body->>'language')||':'||p_sha,0));
 select id into pid from public.analysis_jev_luna_sol_plans where source_plan_id=p.id and language=p_body->>'language' and result_sha256=p_sha;
 if found then return pid;end if;
 insert into public.analysis_jev_luna_sol_plans(organization_id,establishment_id,source_plan_id,source_snapshot_id,version,language,body,result_sha256,config_sha256,dossier_sha256,statistics_sha256,max_luna_calls,question_count)
 values(p.organization_id,p.establishment_id,p.id,s.id,'jev-luna-sol-hybrid-v1',p_body->>'language',p_body,p_sha,p_body->>'config_sha256',p_body->>'dossier_sha256',p_body->>'statistics_sha256',(p_body->>'max_luna_calls')::int,(p_body->>'question_count')::int) returning id into pid;
 insert into public.analysis_jev_luna_sol_events(organization_id,plan_id,action,payload) values(p.organization_id,pid,'free_preparation_frozen',jsonb_build_object('paid_calls',0,'spending_authorized',false,'operator','authenticated_admin'));
 return pid;
end $$;
create function public.start_jls_run(p_plan uuid) returns uuid language plpgsql security invoker set search_path='' as $$begin raise exception 'JLS_PAID_EXECUTION_DISABLED';end $$;
create function public.claim_jls_task(p_run uuid,p_worker text) returns jsonb language plpgsql security invoker set search_path='' as $$begin raise exception 'JLS_PAID_EXECUTION_DISABLED';end $$;
revoke all on function public.save_jls_preparation(jsonb,text),public.start_jls_run(uuid),public.claim_jls_task(uuid,text),public.jls_execution_closed() from public,anon,authenticated;
grant execute on function public.save_jls_preparation(jsonb,text),public.start_jls_run(uuid),public.claim_jls_task(uuid,text) to service_role;
