-- Isolated shared-short-instruction comparison. Existing tenant RLS, queue,
-- immutable receipts and exactly-once dispatch intents remain in use.
create function public.check_short_common_comparison_sources(b jsonb) returns boolean
language plpgsql stable set search_path='' set jit=off as $$
declare a public.analysis_jls_snapshot_preparations;src jsonb;i jsonb;old jsonb;t jsonb;o jsonb;expected jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into a from public.analysis_jls_snapshot_preparations where id=(b->>'source_archive_id')::uuid;
 src=a.body#>'{protocol,body}';
 if not coalesce(b->>'version'='direct4-short-common-comparison-v1'
 and a.id='8e461b23-8b91-4aa2-9d6e-902e8e8ce0e0'::uuid and a.sha256=b->>'source_archive_sha256'
 and a.sha256='a30f8eb403b15f92c0b67a7af130001b77ad83fbcf1ca60e20d4126a1f9d1e1f'
 and a.sha256=public.jls_restaurant_hash(a.body) and a.body#>>'{run,status}'='completed'
 and b->>'source_protocol_id'=a.body#>>'{protocol,id}' and b->>'source_snapshot_sha256'=src->>'source_snapshot_sha256'
 and b->>'organization_id'=src->>'organization_id' and b->>'establishment_id'=src->>'establishment_id'
 and b->>'authority_user_id'=src->>'authority_user_id' and b->>'max_jev_calls'='87' and b->>'max_luna_calls'='87' and b->>'max_sol_calls'='0'
 and b->>'production_enabled'='false' and b->>'preparation_is_not_spending_authorization'='true'
 and b->>'corpus_previously_examined'='true' and b->>'not_new_independent_validation'='true'
 and jsonb_array_length(b->'items')=87 and jsonb_array_length(b->'pending')=87
 and b->>'configuration_sha256'=public.jls_restaurant_hash(b->'configuration')
 and b->>'configuration_sha256'='14c20d5525a70b200a711a41ae5e281ea64eaac910196d0a733bed64701930e3',false) then return false;end if;
 if (select count(distinct x->>'review_id') from jsonb_array_elements(b->'items')x)<>87
 or (select count(distinct x->>'review_id') from jsonb_array_elements(b->'pending')x)<>87 then return false;end if;
 for i in select value from jsonb_array_elements(b->'items') loop
  select x into old from jsonb_array_elements(src->'items')x where x->>'review_id'=i->>'review_id';
  select x into t from jsonb_array_elements(a.body->'tasks')x where x->>'review_id'=i->>'review_id';
  select x into o from jsonb_array_elements(a.body->'outcomes')x where x->>'kind'='task:'||(t->>'id');
  if old is null or t is null or o is null or
   i-'baseline_luna'-'jev_request'-'jev_request_sha256'-'luna_request'-'luna_request_sha256'
   is distinct from old-'request_sha256'-'input_json'
   or i->>'analysis_text_sha256' is distinct from encode(extensions.digest(i->>'analysis_text','sha256'),'hex')
   or i->>'original_text_sha256' is distinct from encode(extensions.digest(i->>'original_text','sha256'),'hex')
   or i->'baseline_luna' is distinct from jsonb_build_object('categories',o#>'{body,native_classification,categories}',
    'served_model',o#>>'{body,served_model}','task_id',t->>'id','artifact_sha256',o->>'sha256','usage',o#>'{body,usage}')
  then return false;end if;
  expected=jsonb_build_object('model','jev-1.13.0','state',jsonb_build_object('review_alias',i->>'review_alias','analysis_text',i->>'analysis_text'),
   'questions',(select jsonb_object_agg(k,jsonb_build_object('type','choice','instructions',
    'Pour chaque avis, classe séparément l’opinion exprimée sur la catégorie '||k||' : '||(b#>'{configuration,scopes}'->>k)||'.'||chr(10)||(b#>>'{configuration,rules}'),
    'criteria',b#>'{configuration,choices}')) from unnest(array['service','price','quality','ambiance'])k));
  if i->'jev_request' is distinct from expected or i->>'jev_request_sha256' is distinct from public.jls_restaurant_hash(expected)
  or not exists(select 1 from jsonb_array_elements(b->'pending')v where v is not distinct from jsonb_build_object(
   'review_id',i->>'review_id','request_sha256',i->>'jev_request_sha256','identity',jsonb_build_object(
    'expected_served_model','jev-1.13.0','configuration_sha256',b->>'configuration_sha256')))
  then return false;end if;
  expected=jsonb_build_object('model','gpt-6-luna','input',i#>>'{luna_request,input}','questions',
   (select jsonb_agg(jsonb_build_object('name',k,'type','choice','instructions',i#>>array['jev_request','questions',k,'instructions'],
    'choices',(select jsonb_agg(jsonb_build_object('value',v,'description',b#>>array['configuration','choices',v]) order by n)
    from unnest(array['positive','negative','mixed','neutral','not_mentioned','uncertain']) with ordinality ch(v,n))) order by n)
   from unnest(array['service','price','quality','ambiance']) with ordinality cats(k,n)));
  if i->'luna_request' is distinct from expected or i->>'luna_request_sha256' is distinct from public.jls_restaurant_hash(expected)
  or (i#>>'{luna_request,input}')::jsonb is distinct from i#>'{jev_request,state}' then return false;end if;
 end loop;return true;
 exception when invalid_text_representation then return false;
end $$;
do $$declare expr text;begin select pg_get_expr(conbin,conrelid) into expr from pg_constraint
 where conrelid='public.analysis_jls_restaurant_protocols'::regclass and conname='analysis_jls_restaurant_protocols_establishment_id_check';
 execute 'alter table public.analysis_jls_restaurant_protocols drop constraint analysis_jls_restaurant_protocols_establishment_id_check';
 execute 'alter table public.analysis_jls_restaurant_protocols add constraint analysis_jls_restaurant_protocols_establishment_id_check CHECK ('||expr||
 ' OR (body->>''version''=''direct4-short-common-comparison-v1'' and establishment_id=(body->>''establishment_id'')::uuid
 and organization_id=(body->>''organization_id'')::uuid and authority_user_id=(body->>''authority_user_id'')::uuid
 and public.check_short_common_comparison_sources(body))) NOT VALID';end $$;
create unique index short_common_one_protocol_per_scope on public.analysis_jls_restaurant_protocols((body->>'source_archive_id'),(body->>'configuration_sha256'))
 where body->>'version'='direct4-short-common-comparison-v1';
create function public.save_short_common_comparison(p_body jsonb,p_sha text) returns uuid
language plpgsql set search_path='' set jit=off as $$
declare rid uuid;c jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_sha is distinct from public.jls_restaurant_hash(p_body) or not public.check_short_common_comparison_sources(p_body)
 or not exists(select 1 from public.organization_members m join public.establishments e on e.organization_id=m.organization_id
 where m.organization_id=(p_body->>'organization_id')::uuid and m.user_id=(p_body->>'authority_user_id')::uuid
 and m.role in('owner','admin','manager') and e.id=(p_body->>'establishment_id')::uuid and e.active)
 then raise exception 'SHORT_COMPARISON_SOURCE_CHANGED';end if;
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256)
 values((p_body->>'organization_id')::uuid,(p_body->>'establishment_id')::uuid,(p_body->>'authority_user_id')::uuid,p_body,p_sha)
 on conflict(sha256) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_restaurant_protocols where sha256=p_sha;end if;
 c=jsonb_build_object('version','short-common-source-certificate-v1','protocol_id',rid,'protocol_sha256',p_sha,
 'source_archive_id',p_body->>'source_archive_id','source_archive_sha256',p_body->>'source_archive_sha256',
 'configuration_sha256',p_body->>'configuration_sha256','source_immutable',true,'no_semantic_threshold',true);
 insert into public.analysis_jls_source_certificates(protocol_id,organization_id,establishment_id,authority_user_id,protocol_sha256,body,sha256)
 values(rid,(p_body->>'organization_id')::uuid,(p_body->>'establishment_id')::uuid,(p_body->>'authority_user_id')::uuid,p_sha,c,public.jls_restaurant_hash(c))
 on conflict(protocol_id) do nothing;return rid;
end $$;
create function public.authorize_short_common_comparison(p_protocol uuid,p_consent jsonb,p_sha text) returns uuid
language plpgsql set search_path='' set jit=off as $$
declare p public.analysis_jls_restaurant_protocols;r public.analysis_jls_restaurant_runs;i jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol for update;
 if p.body->>'version' is distinct from 'direct4-short-common-comparison-v1' or not public.check_jls_source_certificate(p.id)
 then raise exception 'SHORT_COMPARISON_PROTOCOL_REQUIRED';end if;
 select * into r from public.analysis_jls_restaurant_runs where protocol_id=p.id and consent->>'consent_source' is distinct from 'technical_qualification_no_spending';
 if r.id is not null then return r.id;end if;
 if p_sha is distinct from public.jls_restaurant_hash(p_consent) or p_consent->>'protocol_sha256' is distinct from p.sha256
 or p_consent->>'consent_source' is distinct from 'user_directive_codex_delegation'
 or p_consent->'operator_identity' is distinct from jsonb_build_object('kind','codex_admin','channel','supabase_mcp')
 or position(p.id::text in coalesce(p_consent->>'scope_resolution',''))=0
 or p_consent->>'directive_sha256' is distinct from encode(extensions.digest(p_consent->>'user_directive','sha256'),'hex')
 or length(p_consent->>'user_directive')<20 or p_consent->>'requested_at' is null or p_consent->>'expires_at' is null
 or abs(extract(epoch from now()-(p_consent->>'requested_at')::timestamptz))>300
 or (p_consent->>'expires_at')::timestamptz<=now() or (p_consent->>'expires_at')::timestamptz>now()+interval '24 hours 5 minutes'
 or p_consent->'scope' is distinct from jsonb_build_object('establishment_id',p.establishment_id,'organization_id',p.organization_id,
 'configuration_sha256',p.body->>'configuration_sha256','max_jev_calls',87,'max_luna_calls',87,'max_sol_calls',0,
 'automatic_retry',false,'provider_client_retries',0,'apify_calls',0)
 then raise exception 'SHORT_COMPARISON_DELEGATION_REQUIRED';end if;
 if not exists(select 1 from public.analysis_jls_snapshot_preparations where protocol_id=p.id and kind='short_common_deployed_probe'
 and body->>'passed'='true' and body->>'provider_calls'='0' and body->>'protocol_sha256'=p.sha256)
 then raise exception 'SHORT_COMPARISON_ACTIVE_PROBE_REQUIRED';end if;
 insert into public.analysis_jls_restaurant_runs(protocol_id,organization_id,stage,consent,consent_sha256,expires_at)
 values(p.id,p.organization_id,'jev',p_consent,p_sha,(p_consent->>'expires_at')::timestamptz) returning * into r;
 for i in select value from jsonb_array_elements(p.body->'items') loop
  insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256,identity)
  values(r.id,p.organization_id,'jev',i->>'review_id',(i->>'review_id')::uuid,i->'jev_request',i->>'jev_request_sha256',
   jsonb_build_object('expected_served_model','jev-1.13.0','configuration_sha256',p.body->>'configuration_sha256'));
 end loop;return r.id;
end $$;
create function public.claim_short_common_task(p_run uuid,p_worker text) returns jsonb
language plpgsql set search_path='' set jit=off as $$
declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;t public.analysis_jls_restaurant_tasks;prefix text;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if p.body->>'version' is distinct from 'direct4-short-common-comparison-v1' or not public.jls_restaurant_valid(r.id)
 or r.stage not in('jev','luna') or p_worker is null or btrim(p_worker)='' or r.worker is distinct from p_worker
 or r.lease_until is null or r.lease_until<=clock_timestamp() then return null;end if;
 prefix=r.stage||'_request';
 select * into t from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=r.stage and status='pending' and request_count=0 order by task_key for update skip locked limit 1;
 if t.id is null then return null;end if;
 if t.request_sha256 is distinct from public.jls_restaurant_hash(t.request)
 or not exists(select 1 from jsonb_array_elements(p.body->'items')i where i->>'review_id'=t.review_id::text
 and i->>(prefix||'_sha256')=t.request_sha256 and i->prefix=t.request
 and (r.stage<>'jev' or t.identity=jsonb_build_object('expected_served_model','jev-1.13.0','configuration_sha256',p.body->>'configuration_sha256')))
 then raise exception 'SHORT_COMPARISON_REQUEST_CHANGED';end if;
 if (select count(*) from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=r.stage and request_count=1)>=87
 then raise exception 'SHORT_COMPARISON_CALL_LIMIT';end if;
 update public.analysis_jls_restaurant_tasks set status='running',request_count=1,worker=p_worker,dispatched_at=now() where id=t.id returning * into t;return to_jsonb(t);
end $$;
create function public.stage_short_common_comparison(p_run uuid,p_worker text,p_stage text,p_tasks jsonb) returns boolean
language plpgsql set search_path='' set jit=off as $$
declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;i jsonb;v jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if p.body->>'version' is distinct from 'direct4-short-common-comparison-v1' or not public.jls_restaurant_valid(r.id)
 or p_worker is null or r.worker is distinct from p_worker or r.lease_until is null or r.lease_until<=clock_timestamp()
 or exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=r.stage and (status<>'completed' or request_count<>1))
 or (select count(*) from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=r.stage)<>87 then return false;end if;
 if r.stage='jev' and p_stage='luna' then
  if jsonb_array_length(p_tasks)<>87 or (select count(distinct x->>'review_id') from jsonb_array_elements(p_tasks)x)<>87
  or not exists(select 1 from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='evidence_plan') then return false;end if;
  for v in select value from jsonb_array_elements(p_tasks) loop
   select x into i from jsonb_array_elements(p.body->'items')x where x->>'review_id'=v->>'review_id';
   if i is null or v->'request' is distinct from i->'luna_request' or v->>'request_sha256' is distinct from i->>'luna_request_sha256'
   then raise exception 'SHORT_COMPARISON_LUNA_MANIFEST_CHANGED';end if;
   insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256)
   values(r.id,r.organization_id,'luna',i->>'review_id',(i->>'review_id')::uuid,i->'luna_request',i->>'luna_request_sha256');
  end loop;
  update public.analysis_jls_restaurant_runs set stage='luna' where id=r.id;return true;
 elsif r.stage='luna' and p_stage='completed' and p_tasks='[]'::jsonb and
  (select count(*) from public.analysis_jls_restaurant_tasks where run_id=r.id)=174
  and exists(select 1 from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='short_common_classification_comparison') then
  update public.analysis_jls_restaurant_runs set status='completed',worker=null,lease_until=null where id=r.id;return true;
 end if;return false;
end $$;
do $$declare d text;begin
 d=pg_get_functiondef('public.claim_jls_restaurant_task(uuid,text)'::regprocedure);
 d=replace(d,'begin if exists','begin if exists(select 1 from public.analysis_jls_restaurant_runs short_scope_run join public.analysis_jls_restaurant_protocols short_scope_protocol on short_scope_protocol.id=short_scope_run.protocol_id where short_scope_run.id=p_run and short_scope_protocol.body->>''version''=''direct4-short-common-comparison-v1'') then return public.claim_short_common_task(p_run,p_worker);end if; if exists');execute d;
 d=pg_get_functiondef('public.stage_jls_restaurant(uuid,text,text,jsonb)'::regprocedure);
 d=replace(d,'begin if exists','begin if exists(select 1 from public.analysis_jls_restaurant_runs short_scope_run join public.analysis_jls_restaurant_protocols short_scope_protocol on short_scope_protocol.id=short_scope_run.protocol_id where short_scope_run.id=p_run and short_scope_protocol.body->>''version''=''direct4-short-common-comparison-v1'') then return public.stage_short_common_comparison(p_run,p_worker,p_stage,p_tasks);end if; if exists');execute d;
 d=pg_get_functiondef('public.save_jls_snapshot_preparation(uuid,text,jsonb,text)'::regprocedure);
 d=replace(d,'''luna-direct4-classification-comparison-v1'')','''luna-direct4-classification-comparison-v1'',''direct4-short-common-comparison-v1'')');execute d;
end $$;
revoke all on function public.check_short_common_comparison_sources(jsonb),public.save_short_common_comparison(jsonb,text),
public.authorize_short_common_comparison(uuid,jsonb,text),public.claim_short_common_task(uuid,text),public.stage_short_common_comparison(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.check_short_common_comparison_sources(jsonb),public.save_short_common_comparison(jsonb,text),
public.authorize_short_common_comparison(uuid,jsonb,text),public.claim_short_common_task(uuid,text),public.stage_short_common_comparison(uuid,text,text,jsonb) to service_role;
