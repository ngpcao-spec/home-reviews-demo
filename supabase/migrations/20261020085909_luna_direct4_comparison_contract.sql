-- Only an experimental contract adapter. Existing tenant RLS, durable runs,
-- tasks, reservations, dispatch intents and immutable receipts are reused.
create function public.check_luna_direct4_comparison_sources(b jsonb) returns boolean
language plpgsql stable set search_path='' set jit=off as $$
declare a public.analysis_jls_snapshot_preparations;p public.analysis_jls_restaurant_protocols;
 i jsonb;s jsonb;j jsonb;q jsonb;template jsonb;expected jsonb;choices jsonb='["positive","negative","mixed","neutral","not_mentioned","uncertain"]';begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into a from public.analysis_jls_snapshot_preparations where id=(b->>'source_archive_id')::uuid;
 select * into p from public.analysis_jls_restaurant_protocols where id=(a.body#>>'{protocol,id}')::uuid;
 if not coalesce(b->>'version'='luna-direct4-classification-comparison-v1' and a.sha256=b->>'source_archive_sha256'
 and a.sha256=public.jls_restaurant_hash(a.body) and a.body#>>'{coverage,analysed_text_reviews}'='87'
 and b->>'organization_id'=p.organization_id::text and b->>'establishment_id'=p.establishment_id::text
 and b->>'authority_user_id'=p.authority_user_id::text and b->>'source_protocol_id'=p.id::text
 and b->>'source_snapshot_sha256'=p.body->>'source_snapshot_sha256'
 and b->>'production_enabled'='false' and b->>'preparation_is_not_spending_authorization'='true'
 and b->>'max_jev_calls'='0' and b->>'max_sol_calls'='0' and b->>'max_luna_calls'='87'
 and jsonb_array_length(b->'items')=87 and jsonb_array_length(b#>'{configuration,questions}')=4
 and b#>>'{configuration,model}'='gpt-6-luna' and b#>>'{configuration,endpoint}'='/v1/decisions'
 and b#>'{configuration,confidence_threshold}'='null'::jsonb and b#>>'{configuration,native_choice_without_filter}'='true'
 and b#>>'{configuration,automatic_retry}'='false' and b->>'configuration_sha256'=public.jls_restaurant_hash(b->'configuration')
 and b#>>'{configuration,source_jev_configuration_sha256}'=p.body->>'classification_configuration_sha256',false) then return false;end if;
 if (select count(distinct x->>'review_id') from jsonb_array_elements(b->'items')x)<>87
 or (select jsonb_agg(x->>'name' order by x->>'name') from jsonb_array_elements(b#>'{configuration,questions}')x)<>'["ambiance","price","quality","service"]'::jsonb then return false;end if;
 for q in select value from jsonb_array_elements(b#>'{configuration,questions}') loop
  template=p.body#>array['configuration','jev_request_template','questions',q->>'name'];
  select jsonb_agg(jsonb_build_object('value',v#>>'{}','description',template->'criteria'->>(v#>>'{}')) order by n)
  into expected from jsonb_array_elements(choices) with ordinality v(v,n);
  if q is distinct from jsonb_build_object('name',q->>'name','type','choice','instructions',template->>'instructions','choices',expected) then return false;end if;
 end loop;
 for i in select value from jsonb_array_elements(b->'items') loop
  select x into s from jsonb_array_elements(a.body#>'{source_snapshot,reviews}')x where x->>'id'=i->>'review_id';
  select x into j from jsonb_array_elements((a.body->'jev_reused_results')||
   (select jsonb_agg(x) from jsonb_array_elements(a.body->'new_task_outcomes')x where x->>'phase'='jev'))x where x->>'review_id'=i->>'review_id';
  select x into q from jsonb_array_elements(p.body#>'{continuation,original_pending}')x where x->>'review_id'=i->>'review_id';
  if s is null or j is null or q is null or i->>'analysis_text' is distinct from s->>'analysis_text'
  or nullif(btrim(i->>'analysis_text'),'') is null or i->>'analysis_text_sha256' is distinct from s->>'analysis_text_sha256'
  or i->>'analysis_text_sha256' is distinct from encode(extensions.digest(i->>'analysis_text','sha256'),'hex')
  or i->>'original_text' is distinct from s->>'original_text' or i->>'original_text_sha256' is distinct from s->>'original_text_sha256'
  or i->'translation_provenance' is distinct from s->'translation_provenance' or i->'rating' is distinct from s->'rating'
  or i->>'review_alias' is distinct from q#>>'{payload,state,review_alias}'
  or i->'jev' is distinct from jsonb_build_object('task_id',j->>'task_id','artifact_sha256',coalesce(j->>'artifact_sha256',j->>'sha256'),
   'request_sha256',j#>>'{body,request_sha256}','served_model',j#>>'{body,direct4_result,model}','usage',j#>'{body,usage}',
   'categories',j#>'{body,direct4_result,categories}')
  or i->>'request_sha256' is distinct from public.jls_restaurant_hash(jsonb_build_object('model','gpt-6-luna',
   'input',i->>'input_json','questions',b#>'{configuration,questions}'))
  or (i->>'input_json')::jsonb is distinct from jsonb_build_object('review_alias',i->>'review_alias','analysis_text',i->>'analysis_text')
  then return false;end if;
 end loop;return true;
 exception when invalid_text_representation then return false;
end $$;
-- Keep every existing corpus restriction; add only the checked comparison contract.
do $$declare d text;begin select pg_get_constraintdef(oid) into d from pg_constraint
 where conrelid='public.analysis_jls_restaurant_protocols'::regclass and conname='analysis_jls_restaurant_protocols_establishment_id_check';
 execute 'alter table public.analysis_jls_restaurant_protocols drop constraint analysis_jls_restaurant_protocols_establishment_id_check';
 execute 'alter table public.analysis_jls_restaurant_protocols add constraint analysis_jls_restaurant_protocols_establishment_id_check CHECK ('||
 substring(d from 8 for length(d)-8)||' OR (body->>''version''=''luna-direct4-classification-comparison-v1'' and public.check_luna_direct4_comparison_sources(body))) NOT VALID';end $$;
create unique index luna_direct4_one_comparison_per_archive on public.analysis_jls_restaurant_protocols((body->>'source_archive_id'))
 where body->>'version'='luna-direct4-classification-comparison-v1';

create function public.save_luna_direct4_comparison(p_body jsonb,p_sha text) returns uuid
language plpgsql set search_path='' set jit=off as $$
declare rid uuid;sha text;c jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_sha is distinct from public.jls_restaurant_hash(p_body) or not public.check_luna_direct4_comparison_sources(p_body)
 or not exists(select 1 from public.organization_members m join public.establishments e on e.organization_id=m.organization_id
 where m.organization_id=(p_body->>'organization_id')::uuid and m.user_id=(p_body->>'authority_user_id')::uuid
 and m.role in('owner','admin','manager') and e.id=(p_body->>'establishment_id')::uuid and e.active)
 then raise exception 'LUNA_DIRECT4_SOURCE_CHANGED';end if;
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256)
 values((p_body->>'organization_id')::uuid,(p_body->>'establishment_id')::uuid,(p_body->>'authority_user_id')::uuid,p_body,p_sha)
 on conflict(sha256) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_restaurant_protocols where sha256=p_sha;end if;
 c=jsonb_build_object('version','luna-direct4-source-certificate-v1','protocol_id',rid,'protocol_sha256',p_sha,
 'source_archive_id',p_body->>'source_archive_id','source_archive_sha256',p_body->>'source_archive_sha256',
 'configuration_sha256',p_body->>'configuration_sha256','source_immutable',true,'no_semantic_threshold',true);
 sha=public.jls_restaurant_hash(c);
 insert into public.analysis_jls_source_certificates(protocol_id,organization_id,establishment_id,authority_user_id,protocol_sha256,body,sha256)
 values(rid,(p_body->>'organization_id')::uuid,(p_body->>'establishment_id')::uuid,(p_body->>'authority_user_id')::uuid,p_sha,c,sha)
 on conflict(protocol_id) do nothing;
 return rid;
end $$;

create function public.authorize_luna_direct4_comparison(p_protocol uuid,p_consent jsonb,p_sha text) returns uuid
language plpgsql set search_path='' set jit=off as $$
declare p public.analysis_jls_restaurant_protocols;r public.analysis_jls_restaurant_runs;v jsonb;groups jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol for update;
 if p.body->>'version' is distinct from 'luna-direct4-classification-comparison-v1' or not public.check_jls_source_certificate(p.id)
 then raise exception 'LUNA_DIRECT4_PROTOCOL_REQUIRED';end if;
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
 'configuration_sha256',p.body->>'configuration_sha256','max_jev_calls',0,'max_luna_calls',87,'max_sol_calls',0,
 'automatic_retry',false,'provider_client_retries',0,'apify_calls',0)
 then raise exception 'LUNA_DIRECT4_DELEGATION_REQUIRED';end if;
 if not exists(select 1 from public.analysis_jls_snapshot_preparations where protocol_id=p.id and kind='luna_direct4_deployed_probe'
 and body->>'passed'='true' and body->>'provider_calls'='0' and body->>'protocol_sha256'=p.sha256)
 then raise exception 'LUNA_DIRECT4_ACTIVE_PROBE_REQUIRED';end if;
 insert into public.analysis_jls_restaurant_runs(protocol_id,organization_id,stage,consent,consent_sha256,expires_at)
 values(p.id,p.organization_id,'luna',p_consent,p_sha,(p_consent->>'expires_at')::timestamptz) returning * into r;
 for v in select value from jsonb_array_elements(p.body->'items') loop
  insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256)
  values(r.id,p.organization_id,'luna',v->>'review_id',(v->>'review_id')::uuid,
   jsonb_build_object('model','gpt-6-luna','input',v->>'input_json','questions',p.body#>'{configuration,questions}'),v->>'request_sha256');
 end loop;
 select jsonb_build_object('luna_groups',jsonb_agg(jsonb_build_object('review_id',value->>'review_id','request_sha256',value->>'request_sha256')))
 into groups from jsonb_array_elements(p.body->'items');
 insert into public.analysis_jls_restaurant_artifacts(run_id,organization_id,kind,body,sha256)
 values(r.id,p.organization_id,'evidence_plan',groups,public.jls_restaurant_hash(groups));return r.id;
end $$;

create function public.claim_luna_direct4_comparison_task(p_run uuid,p_worker text) returns jsonb
language plpgsql set search_path='' set jit=off as $$
declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;t public.analysis_jls_restaurant_tasks;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if p.body->>'version' is distinct from 'luna-direct4-classification-comparison-v1' or not public.jls_restaurant_valid(r.id)
 or r.stage<>'luna' or p_worker is null or btrim(p_worker)='' or r.worker is distinct from p_worker
 or r.lease_until is null or r.lease_until<=clock_timestamp() then return null;end if;
 select * into t from public.analysis_jls_restaurant_tasks where run_id=r.id and phase='luna' and status='pending' and request_count=0 order by task_key for update skip locked limit 1;
 if t.id is null then return null;end if;
 if t.request_sha256<>public.jls_restaurant_hash(t.request) or t.request->>'model'<>'gpt-6-luna'
 or not exists(select 1 from jsonb_array_elements(p.body->'items')i where i->>'review_id'=t.review_id::text and i->>'request_sha256'=t.request_sha256)
 then raise exception 'LUNA_DIRECT4_REQUEST_CHANGED';end if;
 if (select count(*) from public.analysis_jls_restaurant_tasks where run_id=r.id and request_count=1)>=87 then raise exception 'LUNA_DIRECT4_CALL_LIMIT';end if;
 update public.analysis_jls_restaurant_tasks set status='running',request_count=1,worker=p_worker,dispatched_at=now() where id=t.id returning * into t;
 return to_jsonb(t);
end $$;
create function public.finish_luna_direct4_comparison(p_run uuid,p_worker text) returns boolean
language plpgsql set search_path='' as $$
declare r public.analysis_jls_restaurant_runs;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 if not public.jls_restaurant_valid(r.id) or p_worker is null or r.worker is distinct from p_worker
 or r.lease_until is null or r.lease_until<=clock_timestamp() or r.stage<>'luna'
 or exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=r.id and (phase<>'luna' or status<>'completed' or request_count<>1))
 or (select count(*) from public.analysis_jls_restaurant_tasks where run_id=r.id)<>87
 or not exists(select 1 from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='native_classification_comparison')
 then return false;end if;
 update public.analysis_jls_restaurant_runs set status='completed',worker=null,lease_until=null where id=r.id;return true;
end $$;
do $$declare d text;begin
 d=pg_get_functiondef('public.claim_jls_restaurant_task(uuid,text)'::regprocedure);
 d=replace(d,'begin if exists','begin if exists(select 1 from public.analysis_jls_restaurant_runs r join public.analysis_jls_restaurant_protocols p on p.id=r.protocol_id where r.id=p_run and p.body->>''version''=''luna-direct4-classification-comparison-v1'') then return public.claim_luna_direct4_comparison_task(p_run,p_worker);end if; if exists');execute d;
 d=pg_get_functiondef('public.stage_jls_restaurant(uuid,text,text,jsonb)'::regprocedure);
 d=replace(d,'begin if exists','begin if exists(select 1 from public.analysis_jls_restaurant_runs r join public.analysis_jls_restaurant_protocols p on p.id=r.protocol_id where r.id=p_run and p.body->>''version''=''luna-direct4-classification-comparison-v1'') then if p_stage<>''completed'' or p_tasks<>''[]''::jsonb then return false;end if; return public.finish_luna_direct4_comparison(p_run,p_worker);end if; if exists');execute d;
 d=pg_get_functiondef('public.save_jls_snapshot_preparation(uuid,text,jsonb,text)'::regprocedure);
 d=replace(d,'''jls-direct4-frozen-corpus-v1'')','''jls-direct4-frozen-corpus-v1'',''luna-direct4-classification-comparison-v1'')');execute d;
end $$;
revoke all on function public.check_luna_direct4_comparison_sources(jsonb),public.save_luna_direct4_comparison(jsonb,text),
 public.authorize_luna_direct4_comparison(uuid,jsonb,text),public.claim_luna_direct4_comparison_task(uuid,text),public.finish_luna_direct4_comparison(uuid,text) from public,anon,authenticated;
grant execute on function public.check_luna_direct4_comparison_sources(jsonb),public.save_luna_direct4_comparison(jsonb,text),
 public.authorize_luna_direct4_comparison(uuid,jsonb,text),public.claim_luna_direct4_comparison_task(uuid,text),public.finish_luna_direct4_comparison(uuid,text) to service_role;
