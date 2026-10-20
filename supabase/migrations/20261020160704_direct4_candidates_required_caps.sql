create or replace function public.check_jls_candidates_sources(b jsonb) returns boolean
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
 or b->>'language' is distinct from 'vi' or b->>'max_jev_calls' is distinct from '0' or b->>'max_luna_calls' is distinct from '0' or b->>'max_sol_calls' is distinct from '1' or b->>'max_apify_calls' is distinct from '0'
 or b->>'automatic_retry' is distinct from 'false' or b->>'production_enabled' is distinct from 'false' or b->'pending' is distinct from '[]'::jsonb
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
