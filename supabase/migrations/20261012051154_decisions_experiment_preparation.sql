-- Separate free preparation, no authorization or dispatch path.
create table public.analysis_decisions_experiments(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),source_set_id uuid not null references public.analysis_jev_compact_sets(id),
 version text not null check(version='openai-decisions-exploratory-v1'),status text not null default 'prepared' check(status='prepared'),
 body jsonb not null,result_sha256 text not null check(result_sha256~'^[a-f0-9]{64}$'),created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 paid_enabled boolean not null default false check(not paid_enabled),production_enabled boolean not null default false check(not production_enabled),unique(organization_id,source_set_id,version),unique(id,organization_id)
);
create table public.analysis_decisions_configurations(
 organization_id uuid not null references public.organizations(id),configuration_id text not null,config_sha256 text not null check(config_sha256~'^[a-f0-9]{64}$'),body jsonb not null,
 created_at timestamptz not null default now(),primary key(organization_id,configuration_id)
);
create table public.analysis_decisions_tasks(
 id uuid primary key default gen_random_uuid(),experiment_id uuid not null,organization_id uuid not null,variant text not null check(variant in('choice','predicate','evidence')),review_id uuid not null references public.reviews(id),
 configuration_id text not null,request_sha256 text not null,analysis_text_sha256 text not null,repeat int not null default 1 check(repeat=1),status text not null default 'blocked' check(status='blocked'),
 request_count int not null default 0 check(request_count=0),automatic_retry boolean not null default false check(not automatic_retry),response jsonb,served_model text,input_tokens bigint,output_tokens bigint,cost_usd numeric,duration_ms bigint,error_code text,
 created_at timestamptz not null default now(),foreign key(experiment_id,organization_id) references public.analysis_decisions_experiments(id,organization_id),foreign key(organization_id,configuration_id) references public.analysis_decisions_configurations(organization_id,configuration_id),unique(experiment_id,variant,review_id,configuration_id,request_sha256)
);
create table public.analysis_decisions_results(
 id uuid primary key default gen_random_uuid(),experiment_id uuid not null,organization_id uuid not null,result jsonb not null,result_sha256 text not null,reference_type text not null default 'AI_reference_not_human_gold' check(reference_type='AI_reference_not_human_gold'),created_at timestamptz not null default now(),
 foreign key(experiment_id,organization_id) references public.analysis_decisions_experiments(id,organization_id),unique(experiment_id,result_sha256)
);
do $$declare t text;begin foreach t in array array['analysis_decisions_experiments','analysis_decisions_configurations','analysis_decisions_tasks','analysis_decisions_results'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);execute format('grant all on public.%I to service_role',t);
 execute format('create policy decisions_org_read on public.%I for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=%I.organization_id and m.user_id=(select auth.uid()) and m.role in(''owner'',''admin'',''manager'')))',t,t);
 execute format('create trigger decisions_immutable before update or delete on public.%I for each row execute function public.pilot_evidence_immutable()',t);
 execute format('create index %I on public.%I(organization_id)',t||'_org',t);
end loop;end $$;
create index decisions_exp_source on public.analysis_decisions_experiments(source_set_id);create index decisions_exp_actor on public.analysis_decisions_experiments(created_by);create index decisions_task_review on public.analysis_decisions_tasks(review_id);
create function public.decisions_task_scope_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.reviews r where r.id=new.review_id and r.organization_id=new.organization_id) then raise exception 'DECISIONS_CROSS_TENANT';end if;
 if not exists(select 1 from public.analysis_decisions_experiments e where e.id=new.experiment_id and e.organization_id=new.organization_id and ((new.variant in('choice','predicate') and exists(select 1 from public.analysis_jev_compact_items i join public.analysis_jev_compact_texts t on t.id=i.text_id where i.set_id=e.source_set_id and i.review_id=new.review_id and t.analysis_text_sha256=new.analysis_text_sha256)) or (new.variant='evidence' and exists(select 1 from jsonb_array_elements(e.body->'evidence_verification'->'items') it where it->>'review_id'=new.review_id::text and it->>'analysis_text_sha256'=new.analysis_text_sha256)))) then raise exception 'DECISIONS_TASK_SCOPE_CHANGED';end if;
 return new;
end $$;
create trigger decisions_task_scope before insert on public.analysis_decisions_tasks for each row execute function public.decisions_task_scope_guard();
revoke all on function public.decisions_task_scope_guard() from public,anon,authenticated;
create function public.save_decisions_preparation(p_user uuid,p_body jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' as $$
declare s public.analysis_jev_compact_sets;seal public.analysis_jev_compact_seals;pid uuid;cfg jsonb;rv jsonb;
begin
 select * into s from public.analysis_jev_compact_sets where id=(p_body->>'source_set_id')::uuid;
 select * into seal from public.analysis_jev_compact_seals where set_id=s.id;
 if s.id is null or s.status<>'sealed' or not exists(select 1 from public.organization_members where organization_id=s.organization_id and user_id=p_user and role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if p_body->>'version' is distinct from 'openai-decisions-exploratory-v1' or p_body->>'organization_id' is distinct from s.organization_id::text or p_body->>'paid_enabled' is distinct from 'false' or p_body->>'production_enabled' is distinct from 'false' or p_body->>'new_paid_calls' is distinct from '0' or p_body->>'reference_type' is distinct from 'sealed_GPT6_AI_not_human_gold' or p_body->'source_seal'->>'dataset_sha256' is distinct from seal.dataset_sha256 or p_body->'source_seal'->>'reference_sha256' is distinct from seal.reference_sha256 or p_body->>'source_v12_sha256' is distinct from seal.configuration_a_sha256 or (p_body->>'reference_count')::int<>800 or (p_body->>'uncertain_reference_count')::int<>seal.uncertain_labels or jsonb_array_length(p_body->'reviews')<>32 or jsonb_array_length(p_body->'requests')<>64 or jsonb_array_length(p_body->'configurations')<>3 or p_body->'decision_results' is distinct from 'null'::jsonb then raise exception 'DECISIONS_SCOPE_CHANGED';end if;
 if p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body),'sha256'),'hex') then raise exception 'DECISIONS_HASH_CHANGED';end if;
 for rv in select value from jsonb_array_elements(p_body->'reviews') loop
  if not exists(select 1 from public.analysis_jev_compact_items i join public.analysis_jev_compact_texts t on t.id=i.text_id where i.set_id=s.id and i.organization_id=s.organization_id and i.review_id=(rv->>'review_id')::uuid and t.language='en' and t.analysis_text=rv->>'analysis_text' and t.analysis_text_sha256=rv->>'analysis_text_sha256') then raise exception 'DECISIONS_TEXT_CHANGED';end if;
 end loop;
 if not exists(select 1 from public.analysis_jev_pilot_evidence_v3_controls c where c.id=(p_body->'evidence_verification'->>'control_id')::uuid and c.organization_id=s.organization_id and c.result_sha256=p_body->'evidence_verification'->>'control_sha256') then raise exception 'DECISIONS_CONTROL_CHANGED';end if;
 for cfg in select value from jsonb_array_elements(p_body->'configurations') loop
  if cfg->>'sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(cfg->'body'),'sha256'),'hex') or cfg->'body'->>'model' is distinct from 'gpt-6-luna' or cfg->'body'->>'paid_enabled' is distinct from 'false' or cfg->'body'->>'source_configuration' is distinct from 'v12_economy_1pass_v1' then raise exception 'DECISIONS_CONFIG_CHANGED';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(s.organization_id::text||':'||s.id::text||':decisions-v1',0));
 select id into pid from public.analysis_decisions_experiments where organization_id=s.organization_id and source_set_id=s.id and version=p_body->>'version';
 if found then if not exists(select 1 from public.analysis_decisions_experiments where id=pid and result_sha256=p_sha) then raise exception 'DECISIONS_PREPARATION_IMMUTABLE';end if;return pid;end if;
 for cfg in select value from jsonb_array_elements(p_body->'configurations') loop
  insert into public.analysis_decisions_configurations(organization_id,configuration_id,config_sha256,body) values(s.organization_id,cfg->'body'->>'id',cfg->>'sha256',cfg->'body') on conflict do nothing;
  if not exists(select 1 from public.analysis_decisions_configurations where organization_id=s.organization_id and configuration_id=cfg->'body'->>'id' and config_sha256=cfg->>'sha256') then raise exception 'DECISIONS_CONFIG_IMMUTABLE';end if;
 end loop;
 insert into public.analysis_decisions_experiments(organization_id,source_set_id,version,body,result_sha256,created_by) values(s.organization_id,s.id,p_body->>'version',p_body,p_sha,p_user) returning id into pid;return pid;
end $$;
revoke all on function public.save_decisions_preparation(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_decisions_preparation(uuid,jsonb,text) to service_role;
