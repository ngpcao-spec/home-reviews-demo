-- A protocol owns its frozen corpus. No consent, execution, task or provider
-- call is created by this migration. Legacy protocol branches remain pinned.
create function public.check_jls_direct4_frozen_sources(b jsonb) returns boolean
language plpgsql stable set search_path='' set jit='off' as $$
declare h public.historical_report_runs;published public.historical_establishment_reports;
 x jsonb;r jsonb;n int;nt int;canon text;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into h from public.historical_report_runs where id=(b->'historical'->>'id')::uuid;
 select * into published from public.historical_establishment_reports where id=(b->'frozen_published_report'->>'id')::uuid;
 n=jsonb_array_length(h.snapshot->'reviews');
 select count(*) into nt from jsonb_array_elements(h.snapshot->'reviews') v where btrim(coalesce(v->>'original_text',''))<>'';
 canon=b->>'published_report_canonical';
 if not coalesce(b->>'version'='jls-direct4-frozen-corpus-v1' and h.status='completed' and h.language='vi'
 and h.snapshot->>'analysis_version'='7' and n>0 and nt>0
 and b->>'organization_id'=h.organization_id::text and b->>'establishment_id'=h.establishment_id::text
 and b->>'authority_user_id'=h.requested_by::text and b->>'language'='vi'
 and public.jls_restaurant_hash(to_jsonb(h))=b->'historical'->>'record_sha256' and b->'frozen_historical'=to_jsonb(h)
 and b->'historical'->>'generation_id'=h.generation_id::text
 and b->'historical'->>'source_fingerprint'=h.snapshot->'base'->>'source_fingerprint'
 and b->'historical'->>'snapshot_sha256'=public.jls_restaurant_hash(h.snapshot)
 and published.generation_id=h.generation_id and published.organization_id=h.organization_id and published.establishment_id=h.establishment_id
 and canon::jsonb=b->'frozen_published_report' and canon::jsonb=to_jsonb(published)
 and encode(extensions.digest(canon,'sha256'),'hex')=b->'historical'->>'published_report_sha256'
 and public.jls_restaurant_hash(to_jsonb(published))=b->'historical'->>'published_report_sha256'
 and b->>'source_snapshot_sha256'=public.jls_restaurant_hash(b->'source_snapshot')
 and b->'source_snapshot'->>'source_reviews_sha256'=public.jls_restaurant_hash(b->'source_snapshot'->'reviews')
 and jsonb_array_length(b->'source_snapshot'->'reviews')=n
 and (select count(distinct value->>'id') from jsonb_array_elements(b->'source_snapshot'->'reviews'))=n
 and (select count(distinct value->>'id') from jsonb_array_elements(h.snapshot->'reviews'))=n
 and b->'denominators'=jsonb_build_object('source_reviews',n,'analytical_reviews',nt,'textless_statistics_only',n-nt)
 and (b->>'max_jev_calls')::int=nt and b->>'max_luna_calls'='32' and b->>'max_sol_calls'='1' and b->>'max_apify_calls'='0'
 and b->>'automatic_retry'='false' and b->>'production_enabled'='false' and b->'spending_authorization'='null'::jsonb
 and b->'run_id'='null'::jsonb and b->>'preparation_is_not_spending_authorization'='true'
 and b->>'classification_configuration_sha256'='e5995c6e4b3a8f5949cbcde2531180ad3af503e50ee38b1b7674fceed561fe69'
 and b->>'classification_configuration_sha256'=public.jls_restaurant_hash(b->'configuration'->'jev')
 and b->'configuration'->>'version'=b->>'version'
 and b->'configuration'->>'synthesis_version'='jls-direct4-balanced-synthesis-v1.1'
 and b->'configuration'->>'synthesis_policy_sha256'='c7d0ce50da51ed154f7eb9a5038909c213ed432a867abfbbec9b64dfdc2717d3'
 and b->'configuration'->'policy'->>'automatic_retry'='false' and b->'configuration'->'policy'->>'provider_client_retries'='0'
 and b->'configuration'->'jev_request_template'->'questions'=b->'configuration'->'jev'->'questions'
 and b->>'configuration_sha256'=public.jls_restaurant_hash(b->'configuration')
 and b->>'pending_sha256'=public.jls_restaurant_hash(b->'pending') and jsonb_array_length(b->'pending')=nt
 and (select count(distinct value->>'review_id') from jsonb_array_elements(b->'pending'))=nt
 and b->'cache'='[]'::jsonb and b->>'cache_sha256'=public.jls_restaurant_hash('[]'::jsonb)
 and b->'sol_size_policy'->>'input_budget_tokens'='32768' and b->'sol_size_policy'->>'max_output_tokens'='9500'
 and exists(select 1 from public.establishments e where e.id=h.establishment_id and e.organization_id=h.organization_id and e.active)
 and exists(select 1 from public.organization_members m where m.organization_id=h.organization_id and m.user_id=h.requested_by and m.role in('owner','admin','manager')),false) then return false;end if;
 for x in select value from jsonb_array_elements(b->'source_snapshot'->'reviews') loop
 select value into r from jsonb_array_elements(h.snapshot->'reviews') where value->>'id'=x->>'id';
 if r is null or x->>'original_text' is distinct from coalesce(r->>'original_text','')
 or x->>'analysis_text' is distinct from nullif(r->>'analysis_text','') or x->'rating' is distinct from r->'rating'
 or x->'review_context' is distinct from r->'review_context' or x->'review_detailed_rating' is distinct from r->'review_detailed_rating'
 or x->'published_at' is distinct from r->'published_at' or x->'analysis_source' is distinct from r->'analysis_source'
 or x->'analysis_language' is distinct from r->'analysis_language'
 or x->'translation_provenance' is distinct from jsonb_build_object('historical_run_id',h.id,'source',r->'analysis_source','original_language',r->'original_language','frozen',true,'provider_translation_id',null)
 or x->>'organization_id' is distinct from h.organization_id::text or x->>'establishment_id' is distinct from h.establishment_id::text
 or x->>'original_text_sha256' is distinct from encode(extensions.digest(x->>'original_text','sha256'),'hex')
 or x->>'analysis_text' is not null and (x->>'analysis_text_sha256' is distinct from encode(extensions.digest(x->>'analysis_text','sha256'),'hex')
 or x->>'analysis_language' is distinct from 'en' or x->>'analysis_source' not in('original_en','google_translation_en','verified_translation_override_en'))
 then return false;end if;end loop;
 for x in select value from jsonb_array_elements(b->'pending') loop
 select value into r from jsonb_array_elements(b->'source_snapshot'->'reviews') where value->>'id'=x->>'review_id';
 if r is null or r->>'analysis_text' is null or x->'payload'->'state'->>'analysis_text' is distinct from r->>'analysis_text'
 or x->'payload'->>'model' is distinct from 'jev-latest'
 or x->>'request_sha256' is distinct from public.jls_restaurant_hash((x->'payload')||jsonb_build_object('questions',b->'configuration'->'jev'->'questions'))
 or x->'identity'->>'configuration_id' is distinct from 'jev_categories4_direct_1pass_v1'
 or x->'identity'->>'configuration_sha256' is distinct from b->>'classification_configuration_sha256'
 or x->'identity'->>'requested_model' is distinct from 'jev-latest'
 or x->'identity'->>'expected_served_model' is distinct from 'record_native_no_probe'
 or x->'identity'->>'analysis_text_sha256' is distinct from r->>'analysis_text_sha256' then return false;end if;end loop;
 return true;
 exception when invalid_text_representation or null_value_not_allowed then return false;
end $$;
revoke all on function public.check_jls_direct4_frozen_sources(jsonb) from public,anon,authenticated;
grant execute on function public.check_jls_direct4_frozen_sources(jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.check_jls_direct4_historical_sources(b jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare h public.historical_report_runs;x jsonb;r jsonb;begin
 if b->>'version'='jls-direct4-frozen-corpus-v1' then return public.check_jls_direct4_frozen_sources(b);end if;
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into h from public.historical_report_runs where id=(b->'historical'->>'id')::uuid;
 if not coalesce(b->>'version'='jls-direct4-historical-v1' and h.id='fa55c8a5-f6e3-43df-a792-e9beed974457'::uuid
 and h.establishment_id='6a53577a-c816-4548-845e-870995fbaed9'::uuid and h.status='completed' and h.language='vi'
 and b->>'organization_id'=h.organization_id::text and b->>'establishment_id'=h.establishment_id::text
 and b->>'authority_user_id'=h.requested_by::text and b->>'language'='vi'
 and b->'historical'->>'record_sha256'='0d34685f8bba042afa53f7aab095516f21e17da27ea8390dacca7bbaf0eba46c'
 and public.jls_restaurant_hash(to_jsonb(h))=b->'historical'->>'record_sha256'
 and b->'frozen_historical'=to_jsonb(h)
 and b->'historical'->>'source_fingerprint'=h.snapshot->'base'->>'source_fingerprint'
 and b->'historical'->>'snapshot_sha256'=public.jls_restaurant_hash(h.snapshot)
 and b->'historical'->>'published_report_sha256'=public.jls_restaurant_hash(b->'frozen_published_report')
 and b->'frozen_published_report'->>'generation_id'=h.generation_id::text
 and b->>'source_snapshot_sha256'=public.jls_restaurant_hash(b->'source_snapshot')
 and b->'source_snapshot'->>'source_reviews_sha256'=public.jls_restaurant_hash(b->'source_snapshot'->'reviews')
 and jsonb_array_length(b->'source_snapshot'->'reviews')=100
 and b->'denominators'='{"source_reviews":100,"analytical_reviews":68,"textless_statistics_only":32}'::jsonb
 and b->>'max_jev_calls'='68' and b->>'max_luna_calls'='32' and b->>'max_sol_calls'='1' and b->>'max_apify_calls'='0'
 and b->>'automatic_retry'='false' and b->>'production_enabled'='false' and b->'spending_authorization'='null'::jsonb
 and b->'run_id'='null'::jsonb and b->>'preparation_is_not_spending_authorization'='true'
 and b->>'classification_configuration_sha256'='e5995c6e4b3a8f5949cbcde2531180ad3af503e50ee38b1b7674fceed561fe69'
 and b->>'classification_configuration_sha256'=public.jls_restaurant_hash(b->'configuration'->'jev')
 and b->'configuration'->'jev_request_template'->'questions'=b->'configuration'->'jev'->'questions'
 and b->>'configuration_sha256'=public.jls_restaurant_hash(b->'configuration')
 and b->>'pending_sha256'=public.jls_restaurant_hash(b->'pending') and jsonb_array_length(b->'pending')=68
 and (select count(distinct value->>'review_id') from jsonb_array_elements(b->'pending'))=68
 and b->'cache'='[]'::jsonb and b->>'cache_sha256'=public.jls_restaurant_hash('[]'::jsonb)
 and b->'sol_size_policy'->>'input_budget_tokens'='32768' and b->'sol_size_policy'->>'max_output_tokens'='9500'
 and exists(select 1 from public.establishments e where e.id=h.establishment_id and e.organization_id=h.organization_id and e.active)
 and exists(select 1 from public.organization_members m where m.organization_id=h.organization_id and m.user_id=h.requested_by and m.role in('owner','admin','manager')),false) then return false;end if;
 for x in select value from jsonb_array_elements(b->'source_snapshot'->'reviews') loop
 select value into r from jsonb_array_elements(h.snapshot->'reviews') where value->>'id'=x->>'id';
 if r is null or x->>'original_text' is distinct from coalesce(r->>'original_text','')
 or x->>'analysis_text' is distinct from nullif(r->>'analysis_text','') or x->'rating' is distinct from r->'rating'
 or x->>'organization_id'<>h.organization_id::text or x->>'establishment_id'<>h.establishment_id::text
 or x->>'original_text_sha256'<>encode(extensions.digest(x->>'original_text','sha256'),'hex')
 or x->>'analysis_text' is not null and x->>'analysis_text_sha256'<>encode(extensions.digest(x->>'analysis_text','sha256'),'hex')
 then return false;end if;end loop;
 for x in select value from jsonb_array_elements(b->'pending') loop
 select value into r from jsonb_array_elements(b->'source_snapshot'->'reviews') where value->>'id'=x->>'review_id';
 if r is null or r->>'analysis_text' is null or x->'payload'->'state'->>'analysis_text' is distinct from r->>'analysis_text'
 or x->'payload'->>'model'<>'jev-latest'
 or x->>'request_sha256'<>public.jls_restaurant_hash((x->'payload')||jsonb_build_object('questions',b->'configuration'->'jev'->'questions'))
 or x->'identity'->>'configuration_sha256'<>b->>'classification_configuration_sha256'
 or x->'identity'->>'analysis_text_sha256'<>r->>'analysis_text_sha256' then return false;end if;end loop;return true;
end $function$;

CREATE OR REPLACE FUNCTION public.claim_jls_direct4_historical_task(p_run uuid, p_worker text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;t public.analysis_jls_restaurant_tasks;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 if not public.jls_restaurant_valid(r.id) or r.worker is distinct from p_worker or r.lease_until<=now() then return null;end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if not public.check_jls_direct4_historical_sources(p.body) then raise exception 'DIRECT4_HISTORICAL_SOURCE_CHANGED';end if;
 select * into t from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=r.stage and status='pending' and request_count=0 order by task_key for update skip locked limit 1;
 if t.id is null then return null;end if;
 if t.request_sha256<>public.jls_restaurant_hash(t.request) then raise exception 'JLS_REQUEST_CHANGED';end if;
 if t.phase='jev' and not exists(select 1 from jsonb_array_elements(p.body->'pending') x where x->>'review_id'=t.review_id::text and x->>'request_sha256'=t.request_sha256 and x->'identity'=t.identity)
 then raise exception 'DIRECT4_HISTORICAL_JEV_MANIFEST_CHANGED';end if;
 if (select count(*) from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=t.phase and request_count=1)>=(case t.phase when 'jev' then (p.body->>'max_jev_calls')::int when 'luna' then 32 else 1 end) then raise exception 'JLS_CALL_LIMIT';end if;
 update public.analysis_jls_restaurant_tasks set status='running',request_count=1,worker=p_worker,dispatched_at=now() where id=t.id returning * into t;
 return to_jsonb(t);
end $function$;

CREATE OR REPLACE FUNCTION public.stage_jls_direct4_historical(p_run uuid, p_worker text, p_stage text, p_tasks jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.analysis_jls_restaurant_runs;expected int;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 if not public.jls_restaurant_valid(r.id) or r.worker is distinct from p_worker or r.lease_until<=now() or p_tasks<>'[]'::jsonb
 or not(r.stage='jev' and p_stage='prepare_evidence' or r.stage='luna' and p_stage='prepare_sol') then return false;end if;
 expected=case when r.stage='jev' then (select (body->>'max_jev_calls')::int from public.analysis_jls_restaurant_protocols where id=r.protocol_id) else (select jsonb_array_length(body->'body'->'luna_groups') from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='direct4_report_preparation') end;
 if expected is null or (select count(*) from public.analysis_jls_restaurant_tasks where run_id=r.id and phase=r.stage and status='completed' and request_count=1)<>expected then return false;end if;
 update public.analysis_jls_restaurant_runs set stage=p_stage where id=r.id;return true;
end $function$;

CREATE OR REPLACE FUNCTION public.bind_jls_direct4_historical_evidence(p_run uuid, p_body jsonb, p_sha text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;v jsonb;prep jsonb=p_body->'preparation';rowdata jsonb;expected text;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if not public.jls_restaurant_valid(r.id) or not public.check_jls_direct4_historical_sources(p.body) or r.lease_until>now()
 or r.stage<>'prepare_evidence' or p_sha<>public.jls_restaurant_hash(p_body) or p_body->>'protocol_sha256'<>p.sha256
 or p_body->'dataset'->>'sha256'<>public.jls_restaurant_hash(p_body->'dataset'->'body')
 or prep->>'sha256'<>public.jls_restaurant_hash(prep->'body')
 or prep->'body'->'source_archive'->>'sha256'<>p_body->'dataset'->>'sha256'
 or prep->'body'->'source_snapshot'->>'sha256'<>p.body->>'source_snapshot_sha256'
 or prep->'body'->'statistics'->'scope'<>jsonb_build_object('source_reviews',p.body->'denominators'->'source_reviews','analysed_text_reviews',p.body->'denominators'->'analytical_reviews','textless_statistics_only',p.body->'denominators'->'textless_statistics_only')
 or prep->'body'->'statistics'->'counts'<>p_body->'dataset'->'body'->'counts'
 or jsonb_array_length(p_body->'dataset'->'body'->'reviews')<>(p.body->>'max_jev_calls')::int
 or jsonb_array_length(p_body->'jev_source_tasks')<>(p.body->>'max_jev_calls')::int
 or p.body->>'version'='jls-direct4-frozen-corpus-v1' and (prep->'body'->>'version' is distinct from p.body->'configuration'->>'synthesis_version' or prep->'body'->'synthesis'->>'configuration_sha256' is distinct from p.body->'configuration'->>'synthesis_policy_sha256')
 or jsonb_array_length(prep->'body'->'selection'->'selected') not between 1 and 32
 or jsonb_array_length(prep->'body'->'luna_groups') not between 1 and 32 then return false;end if;
 for v in select value from jsonb_array_elements(p_body->'jev_source_tasks') loop
 if not exists(select 1 from public.analysis_jls_restaurant_tasks t join public.analysis_jls_restaurant_artifacts a on a.run_id=t.run_id and a.kind='task:'||t.id
 where t.id=(v->>'task_id')::uuid and t.run_id=r.id and t.phase='jev' and t.status='completed' and t.request_count=1
 and t.request_sha256=v->>'request_sha256' and a.sha256=v->>'artifact_sha256' and a.sha256=public.jls_restaurant_hash(a.body)
 and exists(select 1 from jsonb_array_elements(p_body->'dataset'->'body'->'reviews') d where d->>'review_id'=t.review_id::text
 and d->'result'=a.body->'direct4_result' and d->>'raw_response_text'=a.body->>'raw_response_text')) then return false;end if;end loop;
 for v in select value from jsonb_array_elements(prep->'body'->'selection'->'selected') loop
 select value into rowdata from jsonb_array_elements(p.body->'source_snapshot'->'reviews') where value->>'id'=v->>'review_id';
 if rowdata is null or v->>'quote'<>rowdata->>'analysis_text' or v->>'context'<>rowdata->>'analysis_text'
 or v->>'analysis_text_sha256'<>rowdata->>'analysis_text_sha256' or v->>'quote_sha256'<>rowdata->>'analysis_text_sha256'
 or v->>'category' not in('service','price','quality','ambiance') or v->>'polarity' not in('positive','negative') then return false;end if;end loop;
 if exists(select 1 from public.analysis_jls_restaurant_tasks where run_id=r.id and phase='luna') then return false;end if;
 insert into public.analysis_jls_restaurant_artifacts(run_id,organization_id,kind,body,sha256) values
 (r.id,r.organization_id,'direct4_evidence_bundle',p_body,p_sha),
 (r.id,r.organization_id,'direct4_report_preparation',prep,public.jls_restaurant_hash(prep)),
 (r.id,r.organization_id,'evidence_plan',jsonb_build_object('luna_groups',prep->'body'->'luna_groups'),public.jls_restaurant_hash(jsonb_build_object('luna_groups',prep->'body'->'luna_groups')));
 for v in select value from jsonb_array_elements(prep->'body'->'luna_groups') loop
 if v->>'request_sha256'<>public.jls_restaurant_hash(v->'payload') or v->'payload'->>'model'<>'gpt-6-luna' then raise exception 'JLS_LUNA_MANIFEST_CHANGED';end if;
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,review_id,request,request_sha256)
 values(r.id,r.organization_id,'luna',v->>'review_id',(v->>'review_id')::uuid,v->'payload',v->>'request_sha256');end loop;
 update public.analysis_jls_restaurant_runs set stage='luna' where id=r.id;return true;
end $function$;


do $adapt$ declare d text;f text;expr text;begin
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.analysis_jls_restaurant_protocols'::regclass and conname='analysis_jls_restaurant_protocols_establishment_id_check';
 alter table public.analysis_jls_restaurant_protocols drop constraint analysis_jls_restaurant_protocols_establishment_id_check;
 execute 'alter table public.analysis_jls_restaurant_protocols add constraint analysis_jls_restaurant_protocols_establishment_id_check check (('||expr||') or (body->>''version''=''jls-direct4-frozen-corpus-v1'' and establishment_id=(body->>''establishment_id'')::uuid and organization_id=(body->>''organization_id'')::uuid and authority_user_id=(body->>''authority_user_id'')::uuid and public.check_jls_direct4_frozen_sources(body)))';
 foreach f in array array['public.save_jls_restaurant_protocol(jsonb,text)','public.authorize_jls_restaurant(uuid,jsonb,text)','public.claim_jls_restaurant_task(uuid,text)','public.stage_jls_restaurant(uuid,text,text,jsonb)','public.check_jls_direct4_ready_sources(jsonb)'] loop
  d=pg_get_functiondef(f::regprocedure);
  if position('='''||'jls-direct4-historical-v1'||'''' in d)=0 then raise exception 'DIRECT4_ROUTE_NOT_FOUND: %',f;end if;
  execute replace(d,'=''jls-direct4-historical-v1''',' in(''jls-direct4-historical-v1'',''jls-direct4-frozen-corpus-v1'')');
 end loop;
 foreach f in array array['public.save_jls_snapshot_preparation(uuid,text,jsonb,text)','public.jls_restaurant_state_guard()'] loop
  d=pg_get_functiondef(f::regprocedure);
  execute replace(d,'''jls-direct4-synthesis-comparison-v1'')','''jls-direct4-synthesis-comparison-v1'',''jls-direct4-frozen-corpus-v1'')');
 end loop;
end $adapt$;
