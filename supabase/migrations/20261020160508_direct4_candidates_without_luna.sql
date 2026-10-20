-- A scoped candidate-only contract. Existing queues, leases, single Sol claim,
-- durable receipt, finalization, org RLS and historical guards remain in use.
create function public.check_jls_candidates_sources(b jsonb) returns boolean
language plpgsql stable set search_path='' set jit='off' as $$
declare a public.analysis_jls_snapshot_preparations;p public.analysis_jls_restaurant_protocols;
 r public.analysis_jls_restaurant_runs;z public.analysis_jls_restaurant_artifacts;s jsonb;q jsonb;x jsonb;e jsonb;expected jsonb;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 s=b->'source';select * into a from public.analysis_jls_snapshot_preparations where id=(s#>>'{reference_archive,id}')::uuid;
 select * into r from public.analysis_jls_restaurant_runs where id=(s->>'source_run_id')::uuid;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 select * into z from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='direct4_evidence_bundle';
 if a.id is null or r.id is null or p.id is null or z.id is null then return false;end if;
 expected=jsonb_build_object('reference_archive',jsonb_build_object('id',a.id,'sha256',a.sha256),'source_run_id',r.id,
 'source_protocol_id',p.id,'source_protocol_sha256',p.sha256,'organization_id',p.organization_id,'establishment_id',p.establishment_id,
 'authority_user_id',p.authority_user_id,'bundle_sha256',z.sha256,'dataset_sha256',z.body#>'{dataset,sha256}',
 'sources',p.body#>'{source_snapshot,reviews}','statistics',z.body#>'{preparation,body,statistics}',
 'statistics_sha256',z.body#>'{preparation,body,statistics_sha256}','selected',z.body#>'{preparation,body,selection,selected}',
 'originals',z.body#>'{preparation,body,synthesis,originals}','synthesis',z.body#>'{preparation,body,synthesis,version}');
 if s is distinct from expected or a.sha256 is distinct from s#>>'{reference_archive,sha256}' or a.protocol_id<>p.id
 or a.body->>'run_id'<>r.id::text or a.organization_id<>p.organization_id or r.status<>'completed'
 or z.sha256<>s->>'bundle_sha256' or p.organization_id<>r.organization_id
 or b->>'version'<>'jls-direct4-no-luna-candidates-v1' or b->>'organization_id'<>p.organization_id::text
 or b->>'establishment_id'<>p.establishment_id::text or b->>'authority_user_id'<>p.authority_user_id::text
 or b->>'source_sha256'<>public.jls_restaurant_hash(s) or s->>'statistics_sha256'<>public.jls_restaurant_hash(s->'statistics')
 or jsonb_array_length(s->'sources')<>135 or jsonb_array_length(s->'selected')<>32
 or (select count(*) from jsonb_array_elements(s->'sources')v where v->>'analysis_text' is not null)<>75
 or b->>'language'<>'vi' or b->>'max_jev_calls'<>'0' or b->>'max_luna_calls'<>'0' or b->>'max_sol_calls'<>'1' or b->>'max_apify_calls'<>'0'
 or b->>'automatic_retry'<>'false' or b->>'production_enabled'<>'false' or b->'pending'<>'[]'::jsonb
 or b->>'pending_sha256'<>public.jls_restaurant_hash('[]'::jsonb) or b->'spending_authorization'<>'null'::jsonb or b->'run_id'<>'null'::jsonb
 or b->>'preparation_is_not_spending_authorization'<>'true' or b->>'code_provenance'!~'^[a-f0-9]{40}$'
 or b->>'configuration_sha256'<>public.jls_restaurant_hash(b->'configuration')
 or b#>>'{configuration,version}'<>'jls-direct4-no-luna-candidates-v1'
 or b#>>'{configuration,synthesis_version}'<>'jls-direct4-balanced-synthesis-v1.1'
 or b#>'{configuration,policy}'<>'{"model":"gpt-6.1-sol","language":"vi","automatic_retry":false,"provider_client_retries":0,"apify_calls":0}'::jsonb
 or b#>>'{sol_size_policy,input_budget_tokens}'<>'32768' or b#>>'{sol_size_policy,max_output_tokens}'<>'9500'
 or not exists(select 1 from public.organization_members m where m.organization_id=p.organization_id and m.user_id=p.authority_user_id and m.role in('owner','admin','manager'))
 or not exists(select 1 from public.establishments t where t.id=p.establishment_id and t.organization_id=p.organization_id and t.active)
 then return false;end if;
 q=(b#>>'{ready_template,request_json}')::jsonb;
 if b#>>'{ready_template,request_sha256}'<>public.jls_restaurant_hash(q)
 or b#>>'{ready_template,request_raw_sha256}'<>encode(extensions.digest(b#>>'{ready_template,request_json}','sha256'),'hex')
 or q->>'model'<>'gpt-6.1-sol' or q->>'max_output_tokens'<>'9500' or jsonb_array_length(q->'input')<>2
 or q#>>'{input,0,role}'<>'system' or q#>>'{input,1,role}'<>'user'
 or q#>>'{input,0,content}' is distinct from b#>>'{ready_template,draft,prompt}'
 or (q#>>'{input,1,content}')::jsonb is distinct from b#>'{ready_template,draft,packet}'
 or b#>>'{configuration,sol_prompt_sha256}'<>encode(extensions.digest(q#>>'{input,0,content}','sha256'),'hex')
 or b#>>'{configuration,sol_schema_sha256}'<>public.jls_restaurant_hash(q#>'{text,format,schema}')
 or b#>>'{ready_template,token_certificate_sha256}'<>public.jls_restaurant_hash(b#>'{ready_template,token_certificate}')
 or b#>'{ready_template,measurement}' is distinct from b#>'{ready_template,draft,measurement}'
 or b#>>'{ready_template,measurement,input_budget_tokens}'<>'32768'
 or coalesce((b#>>'{ready_template,measurement,guarded_input_tokens}')::int,-1) not between 1 and 32768
 or b#>>'{ready_template,measurement,output_reserved_tokens}'<>'9500'
 then return false;end if;
 q=b#>'{ready_template,draft,packet}';
 if q->>'statistics_sha256' is distinct from s->>'statistics_sha256' or q->'original_reviews' is distinct from s->'originals'
 or q#>'{statistics,scope}' is distinct from s#>'{statistics,scope}' or jsonb_array_length(q->'evidence')<>32
 or q->>'scope'<>'UNVERIFIED_CUSTOMER_CANDIDATES_SOL_SELF_REVIEW' or q?'luna_decisions' or q?'previous_report'
 then return false;end if;
 for x in select value from jsonb_array_elements(q->'evidence') loop
 select value into e from jsonb_array_elements(s->'selected') where value->>'evidence_id'=x->>'evidence_id';
 if e is null or x->>'review_id' is distinct from e->>'review_id' or x->>'category' is distinct from e->>'category'
 or x->>'polarity' is distinct from e->>'polarity' or x->>'quote' is distinct from e->>'quote'
 or x->>'quote_sha256' is distinct from e->>'quote_sha256' or x->>'analysis_text_sha256' is distinct from e->>'analysis_text_sha256'
 or (x-array['evidence_id','review_id','category','polarity','quote','quote_sha256','analysis_text_sha256','translation_source','context_same_as_quote','context','quote_start','quote_end','context_start','context_end'])<>'{}'::jsonb
 then return false;end if;end loop;
 return true;
end $$;

create function public.save_jls_candidates_protocol(p_body jsonb,p_sha text) returns uuid
language plpgsql set search_path='' as $$ declare rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_sha is distinct from public.jls_restaurant_hash(p_body) or not public.check_jls_candidates_sources(p_body) then raise exception 'DIRECT_CANDIDATES_SOURCE_CHANGED';end if;
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256)
 values((p_body->>'organization_id')::uuid,(p_body->>'establishment_id')::uuid,(p_body->>'authority_user_id')::uuid,p_body,p_sha)
 on conflict(sha256) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_restaurant_protocols where sha256=p_sha;end if;return rid;
end $$;

create function public.check_jls_candidates_ready(b jsonb) returns boolean
language plpgsql stable set search_path='' set jit='off' as $$
declare p public.analysis_jls_restaurant_protocols;r public.analysis_jls_restaurant_runs;a jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=(b->>'source_protocol_id')::uuid;
 select * into r from public.analysis_jls_restaurant_runs where id=(b->>'source_run_id')::uuid;
 a=p.body->'ready_template';
 return coalesce(public.check_jls_candidates_sources(p.body) and p.sha256=public.jls_restaurant_hash(p.body)
 and r.protocol_id=p.id and r.organization_id=p.organization_id and p.sha256=b->>'source_protocol_sha256'
 and b=jsonb_build_object('version','jls-direct4-sol-ready-v1','source_protocol_id',p.id,'source_protocol_sha256',p.sha256,'source_run_id',r.id,
 'candidate_template',a,'sol',jsonb_build_object('gate',jsonb_build_object('passed',true,'scope','technical_candidate_sources_not_semantic_acceptance'), 'draft',a->'draft'),
 'request_json',a->'request_json','request_sha256',a->'request_sha256','request_raw_sha256',a->'request_raw_sha256',
 'measurement',a->'measurement','token_certificate',a->'token_certificate','token_certificate_sha256',a->'token_certificate_sha256'),false);
end $$;

create function public.bind_jls_candidates_ready(p_protocol uuid,p_run uuid) returns uuid
language plpgsql set search_path='' as $$ declare p public.analysis_jls_restaurant_protocols;r public.analysis_jls_restaurant_runs;a jsonb;b jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 if r.protocol_id<>p.id or r.organization_id<>p.organization_id or not public.check_jls_candidates_sources(p.body) then raise exception 'DIRECT_CANDIDATES_SOURCE_CHANGED';end if;
 a=p.body->'ready_template';b=jsonb_build_object('version','jls-direct4-sol-ready-v1','source_protocol_id',p.id,'source_protocol_sha256',p.sha256,'source_run_id',r.id,
 'candidate_template',a,'sol',jsonb_build_object('gate',jsonb_build_object('passed',true,'scope','technical_candidate_sources_not_semantic_acceptance'),'draft',a->'draft'),
 'request_json',a->'request_json','request_sha256',a->'request_sha256','request_raw_sha256',a->'request_raw_sha256',
 'measurement',a->'measurement','token_certificate',a->'token_certificate','token_certificate_sha256',a->'token_certificate_sha256');
 return public.save_jls_direct4_ready(b,public.jls_restaurant_hash(b));
end $$;

create function public.prepare_jls_candidates_qualification(p_protocol uuid,p_nonce text) returns uuid
language plpgsql set search_path='' as $$
declare p public.analysis_jls_restaurant_protocols;q public.analysis_jls_sql_qualifications;rid uuid=gen_random_uuid();c jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol for update;
 if p_nonce!~'^[a-z0-9_-]{1,45}$' or not public.check_jls_candidates_sources(p.body) then raise exception 'DIRECT_CANDIDATES_SOURCE_CHANGED';end if;
 select * into q from public.analysis_jls_sql_qualifications where protocol_id=p.id and nonce=p_nonce;if q.id is not null then return q.run_id;end if;
 insert into public.analysis_jls_sql_qualifications(protocol_id,organization_id,protocol_sha256,run_id,nonce,expires_at)
 values(p.id,p.organization_id,p.sha256,rid,p_nonce,now()+interval '2 hours') returning * into q;
 c=jsonb_build_object('consent_source','technical_qualification_no_spending','qualification_id',q.id,'protocol_sha256',p.sha256,'explicit_technical_mock',true,'provider_calls',0,'not_user_authorization',true);
 insert into public.analysis_jls_restaurant_runs(id,protocol_id,organization_id,stage,consent,consent_sha256,expires_at)
 values(rid,p.id,p.organization_id,'prepare_sol',c,public.jls_restaurant_hash(c),q.expires_at);
 perform public.bind_jls_candidates_ready(p.id,rid);return rid;
end $$;

create function public.authorize_jls_candidates(p_protocol uuid,p_consent jsonb,p_sha text) returns uuid
language plpgsql set search_path='' as $$ declare p public.analysis_jls_restaurant_protocols;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol for update;
 if not public.check_jls_candidates_sources(p.body) then raise exception 'DIRECT_CANDIDATES_SOURCE_CHANGED';end if;
 select id into rid from public.analysis_jls_restaurant_runs where protocol_id=p.id and consent->>'consent_source' is distinct from 'technical_qualification_no_spending';
 if rid is not null then return rid;end if;
 if (select count(*) from public.analysis_jls_snapshot_preparations where protocol_id=p.id and kind in('candidate_deployed_probe_sol','candidate_deployed_probe_validate_sol')
 and body->>'protocol_sha256'=p.sha256 and body->>'provider_calls'='0' and body->'result'->>'error_code' is null
 and (body->'result'->>'phase'='raw_receipt_saved' or body->>'validated_report_saved'='true'))<>2
 then raise exception 'DIRECT_CANDIDATES_DEPLOYED_PROBE_REQUIRED';end if;
 if p_consent->'scope_resolution' is distinct from jsonb_build_object('protocol_id',p.id,'source_archive_id',p.body#>>'{source,reference_archive,id}','source_run_id',p.body#>>'{source,source_run_id}')
 or position(p.body#>>'{source,reference_archive,id}' in coalesce(p_consent->>'user_directive',''))=0
 or position(p.body#>>'{source,source_run_id}' in coalesce(p_consent->>'user_directive',''))=0 then raise exception 'DIRECT_CANDIDATES_GO_SCOPE_CHANGED';end if;
 rid=public.authorize_jls_restaurant_pre_ready(p.id,p_consent,p_sha);
 update public.analysis_jls_restaurant_runs set stage='prepare_sol' where id=rid and status='queued' and stage='jev';
 perform public.bind_jls_candidates_ready(p.id,rid);return rid;
end $$;

do $routes$ declare d text;expr text;begin
 select pg_get_expr(conbin,conrelid) into expr from pg_constraint where conrelid='public.analysis_jls_restaurant_protocols'::regclass and conname='analysis_jls_restaurant_protocols_establishment_id_check';
 alter table public.analysis_jls_restaurant_protocols drop constraint analysis_jls_restaurant_protocols_establishment_id_check;
 execute 'alter table public.analysis_jls_restaurant_protocols add constraint analysis_jls_restaurant_protocols_establishment_id_check CHECK ('||expr||
 ' OR (body->>''version''=''jls-direct4-no-luna-candidates-v1'' and establishment_id=(body->>''establishment_id'')::uuid and organization_id=(body->>''organization_id'')::uuid and authority_user_id=(body->>''authority_user_id'')::uuid and public.check_jls_candidates_sources(body))) NOT VALID';
 d=pg_get_functiondef('public.check_jls_direct4_ready_sources(jsonb)'::regprocedure);
 execute replace(d,'begin if exists(', 'begin if exists(select 1 from public.analysis_jls_restaurant_protocols where id=(b->>''source_protocol_id'')::uuid and body->>''version''=''jls-direct4-no-luna-candidates-v1'') then return public.check_jls_candidates_ready(b);end if; if exists(');
 d=pg_get_functiondef('public.jls_restaurant_state_guard()'::regprocedure);
 execute replace(d,'''jls-direct4-short-frozen-corpus-v1''','''jls-direct4-short-frozen-corpus-v1'',''jls-direct4-no-luna-candidates-v1''');
 d=pg_get_functiondef('public.save_jls_snapshot_preparation(uuid,text,jsonb,text)'::regprocedure);
 execute replace(d,'''jls-direct4-short-frozen-corpus-v1''','''jls-direct4-short-frozen-corpus-v1'',''jls-direct4-no-luna-candidates-v1''');
end $routes$;
create unique index jls_candidates_one_comparison on public.analysis_jls_restaurant_protocols((body#>>'{source,reference_archive,id}')) where body->>'version'='jls-direct4-no-luna-candidates-v1';
revoke all on function public.check_jls_candidates_sources(jsonb),public.save_jls_candidates_protocol(jsonb,text),public.check_jls_candidates_ready(jsonb),public.bind_jls_candidates_ready(uuid,uuid),public.prepare_jls_candidates_qualification(uuid,text),public.authorize_jls_candidates(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.check_jls_candidates_sources(jsonb),public.save_jls_candidates_protocol(jsonb,text),public.check_jls_candidates_ready(jsonb),public.bind_jls_candidates_ready(uuid,uuid),public.prepare_jls_candidates_qualification(uuid,text),public.authorize_jls_candidates(uuid,jsonb,text) to service_role;
