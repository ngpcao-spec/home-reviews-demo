CREATE OR REPLACE FUNCTION public.check_jls_direct4_short_frozen_sources(b jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare h public.historical_report_runs;published public.historical_establishment_reports;
 x jsonb;r jsonb;n int;nt int;canon text;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if; if b?'continuation' then return public.check_jls_direct4_partial_sources(b);end if;
 select * into h from public.historical_report_runs where id=(b->'historical'->>'id')::uuid;
 select * into published from public.historical_establishment_reports where id=(b->'frozen_published_report'->>'id')::uuid;
 n=jsonb_array_length(h.snapshot->'reviews');
 select count(*) into nt from jsonb_array_elements(h.snapshot->'reviews') v where btrim(coalesce(v->>'original_text',''))<>'';
 canon=b->>'published_report_canonical';
 if not coalesce(b->>'version'='jls-direct4-short-frozen-corpus-v1' and h.status='completed' and h.language='vi'
 and h.snapshot->>'analysis_version'='7' and n between 1 and 135 and nt>0
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
 and b->>'classification_configuration_sha256'='84e19915b4b01af0bca311790f5a531ae23984b2d4a8cbc7d6340417ff299651'
 and b->>'classification_configuration_sha256'=public.jls_restaurant_hash(b->'configuration'->'jev')
 and b->'configuration'->>'version'=b->>'version'
 and b->'configuration'->>'synthesis_version'='jls-direct4-balanced-synthesis-v1.1'
 and b->'configuration'->>'synthesis_policy_sha256'='c7d0ce50da51ed154f7eb9a5038909c213ed432a867abfbbec9b64dfdc2717d3'
 and b->'configuration'->'policy'->>'automatic_retry'='false' and b->'configuration'->'policy'->>'provider_client_retries'='0'
 and b->'configuration'->'jev_request_template'->'questions'=b->'configuration'->'jev'->'questions'
 and exists(select 1 from public.analysis_jls_snapshot_preparations common_source where common_source.id=(b#>>'{configuration,jev,source_common_archive}')::uuid
and common_source.sha256='17cab3d537e963867c68de0da39ff49b499c08182d54722f550289e2d6a4035e'
and common_source.body#>'{protocol,body,configuration}'=b#>'{configuration,jev,common_configuration}')
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
 or x->'analysis_language' is distinct from r->'analysis_language' or x->'analysis_source' is distinct from r->'analysis_source')
 then return false;end if;end loop;
 for x in select value from jsonb_array_elements(b->'pending') loop
 select value into r from jsonb_array_elements(b->'source_snapshot'->'reviews') where value->>'id'=x->>'review_id';
 if r is null or r->>'analysis_text' is null or x->'payload'->'state'->>'analysis_text' is distinct from r->>'analysis_text'
 or x->'payload'->>'model' is distinct from 'jev-1.13.0'
 or x->>'request_sha256' is distinct from public.jls_restaurant_hash((x->'payload')||jsonb_build_object('questions',b->'configuration'->'jev'->'questions'))
 or x->'identity'->>'configuration_id' is distinct from 'jev_categories4_short_common_1pass_v1'
 or x->'identity'->>'configuration_sha256' is distinct from b->>'classification_configuration_sha256'
 or x->'identity'->>'requested_model' is distinct from 'jev-1.13.0'
 or x->'identity'->>'expected_served_model' is distinct from 'jev-1.13.0'
 or x->'identity'->>'analysis_text_sha256' is distinct from r->>'analysis_text_sha256' then return false;end if;end loop;
 return true;
 exception when invalid_text_representation or null_value_not_allowed then return false;
end $function$

;
revoke all on function public.check_jls_direct4_short_frozen_sources(jsonb) from public,anon,authenticated;
grant execute on function public.check_jls_direct4_short_frozen_sources(jsonb) to service_role;
CREATE OR REPLACE FUNCTION public.check_jls_direct4_historical_sources(b jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare h public.historical_report_runs;x jsonb;r jsonb;begin
 if b->>'version'='jls-direct4-short-frozen-corpus-v1' then return public.check_jls_direct4_short_frozen_sources(b);end if;
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
end $function$

;
do $route$ declare d text;f regprocedure;expr text;begin
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.analysis_jls_restaurant_protocols'::regclass and conname='analysis_jls_restaurant_protocols_establishment_id_check';
 alter table public.analysis_jls_restaurant_protocols drop constraint analysis_jls_restaurant_protocols_establishment_id_check;
 execute 'alter table public.analysis_jls_restaurant_protocols add constraint analysis_jls_restaurant_protocols_establishment_id_check CHECK ('||expr||
 ' OR (body->>''version''=''jls-direct4-short-frozen-corpus-v1'' and establishment_id=(body->>''establishment_id'')::uuid and organization_id=(body->>''organization_id'')::uuid
 and authority_user_id=(body->>''authority_user_id'')::uuid and public.check_jls_direct4_short_frozen_sources(body))) NOT VALID';
 foreach f in array array['public.save_jls_restaurant_protocol(jsonb,text)'::regprocedure,
 'public.claim_jls_restaurant_task(uuid,text)'::regprocedure,'public.stage_jls_restaurant(uuid,text,text,jsonb)'::regprocedure,
 'public.check_jls_direct4_ready_sources(jsonb)'::regprocedure,'public.certify_jls_direct4_sources(uuid)'::regprocedure] loop
 d=pg_get_functiondef(f);
 if position('''jls-direct4-historical-v1'',''jls-direct4-frozen-corpus-v1''' in d)=0 then raise exception 'SHORT_FROZEN_ROUTE_MISSING: %',f;end if;
 execute replace(d,'''jls-direct4-historical-v1'',''jls-direct4-frozen-corpus-v1''','''jls-direct4-historical-v1'',''jls-direct4-frozen-corpus-v1'',''jls-direct4-short-frozen-corpus-v1''');
 end loop;
 foreach f in array array['public.save_jls_snapshot_preparation(uuid,text,jsonb,text)'::regprocedure,'public.jls_restaurant_state_guard()'::regprocedure] loop
 d=pg_get_functiondef(f);execute replace(d,'''jls-direct4-frozen-corpus-v1''','''jls-direct4-frozen-corpus-v1'',''jls-direct4-short-frozen-corpus-v1''');end loop;
 d=pg_get_functiondef('public.bind_jls_direct4_historical_evidence(uuid,jsonb,text)'::regprocedure);
 execute replace(d,'p.body->>''version''=''jls-direct4-frozen-corpus-v1''','p.body->>''version'' in(''jls-direct4-frozen-corpus-v1'',''jls-direct4-short-frozen-corpus-v1'')');
end $route$;

create unique index jls_short_frozen_single_scope on public.analysis_jls_restaurant_protocols((body#>>'{historical,id}'),(body->>'classification_configuration_sha256')) where body->>'version'='jls-direct4-short-frozen-corpus-v1';
do $delegation$ declare d text;begin d=pg_get_functiondef('public.authorize_jls_direct4_historical(uuid,jsonb,text)'::regprocedure);
d=replace(d,'if position(p.id::text in coalesce(p_consent->>''user_directive'',''''))=0 then raise exception ''DIRECT4_HISTORICAL_GO_SCOPE_CHANGED'';end if;',
'if p.body->>''version''=''jls-direct4-short-frozen-corpus-v1'' then
 if p_consent->''scope_resolution'' is distinct from jsonb_build_object(''kind'',''codex_scope_binding'',''protocol_id'',p.id,''historical_run_id'',p.body#>>''{historical,id}'',''published_report_id'',p.body#>>''{frozen_published_report,id}'',''common_prompt_archive_id'',p.body#>>''{configuration,jev,source_common_archive}'') then raise exception ''DIRECT4_HISTORICAL_GO_SCOPE_CHANGED'';end if;
else if position(p.id::text in coalesce(p_consent->>''user_directive'',''''))=0 then raise exception ''DIRECT4_HISTORICAL_GO_SCOPE_CHANGED'';end if;end if;');
execute d;end $delegation$;

-- The immutable protocol contains the canonical published report. Do not freeze
-- the current production publication row: normal commercial refreshes remain free.
do $publication_copy$ declare d text;old text;replacement text;begin
 d=pg_get_functiondef('public.certify_jls_direct4_sources(uuid)'::regprocedure);
 old=$old$insert into public.analysis_jls_source_certificate_refs values
 (p.id,'historical_report_runs',(p.body#>>'{historical,id}')::uuid),
 (p.id,'historical_establishment_reports',(p.body#>>'{frozen_published_report,id}')::uuid) on conflict do nothing;$old$;
 replacement=$new$insert into public.analysis_jls_source_certificate_refs values
 (p.id,'historical_report_runs',(p.body#>>'{historical,id}')::uuid) on conflict do nothing;
 if p.body->>'version'<>'jls-direct4-short-frozen-corpus-v1' then
  insert into public.analysis_jls_source_certificate_refs values
  (p.id,'historical_establishment_reports',(p.body#>>'{frozen_published_report,id}')::uuid) on conflict do nothing;
 end if;$new$;
 if position(old in d)=0 then raise exception 'SHORT_FROZEN_PUBLICATION_CERTIFICATE_SHAPE_CHANGED';end if;
 execute replace(d,old,replacement);
end $publication_copy$;
