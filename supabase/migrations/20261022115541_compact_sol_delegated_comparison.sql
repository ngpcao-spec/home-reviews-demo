-- Reuse candidate-only protocols/runs, Sol-ready reservations and receipts.
-- No new table, scheduler, model prompt or app-report publication path.
create function public.check_jls_compact_comparison(b jsonb) returns boolean
language plpgsql stable set search_path='' set jit='off' as $$
declare a public.analysis_jls_snapshot_preparations;s jsonb;expected jsonb;q jsonb;packet jsonb;m jsonb;r jsonb;e jsonb;x jsonb;meta jsonb;stats jsonb;manifest jsonb;
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 s=b->'source';select * into a from public.analysis_jls_snapshot_preparations where id=(s#>>'{reference_archive,id}')::uuid;
 if a.id is null or a.sha256 is distinct from s#>>'{reference_archive,sha256}'
 or a.body->>'version' is distinct from 'jls-direct4-no-luna-comparison-archive-v1' then return false;end if;
 expected=a.body#>'{protocol,body,source}' || jsonb_build_object('reference_archive',jsonb_build_object('id',a.id,'sha256',a.sha256));
 select jsonb_agg(jsonb_build_object('review_id',v->'review_id','analysis_language',v->'analysis_language','translation_source',v->'translation_source','translation_provenance',v->'translation_provenance') order by v->>'review_id') into meta
 from jsonb_array_elements(a.body#>'{source_input,dataset,body,reviews}')v;
 if s is distinct from expected or b->>'source_sha256' is distinct from public.jls_restaurant_hash(s)
 or b->>'version' is distinct from 'jls-direct4-no-luna-candidates-v1'
 or b->>'organization_id' is distinct from a.organization_id::text or b->>'organization_id' is distinct from s->>'organization_id'
 or b->>'establishment_id' is distinct from s->>'establishment_id' or b->>'authority_user_id' is distinct from s->>'authority_user_id'
 or b->'review_metadata' is distinct from meta or b->>'review_metadata_sha256' is distinct from public.jls_restaurant_hash(meta)
 or b->>'language' is distinct from 'vi' or b->>'max_jev_calls' is distinct from '0' or b->>'max_luna_calls' is distinct from '0'
 or b->>'max_sol_calls' is distinct from '1' or b->>'max_apify_calls' is distinct from '0' or b->>'automatic_retry' is distinct from 'false'
 or b->>'production_enabled' is distinct from 'false' or b->'pending' is distinct from '[]'::jsonb
 or b->>'pending_sha256' is distinct from public.jls_restaurant_hash('[]'::jsonb)
 or b->'spending_authorization' is distinct from 'null'::jsonb or b->'run_id' is distinct from 'null'::jsonb
 or b->>'preparation_is_not_spending_authorization' is distinct from 'true' or coalesce(b->>'code_provenance','')!~'^[a-f0-9]{40}$'
 or b->>'configuration_sha256' is distinct from public.jls_restaurant_hash(b->'configuration')
 or b#>>'{configuration,comparison_version}' is distinct from 'jls-direct4-compact-comparison-v1'
 or b#>>'{configuration,sol_wire_version}' is distinct from 'jls-direct4-compact-sol-v1'
 or b#>'{configuration,policy}' is distinct from '{"model":"gpt-6.1-sol","language":"vi","automatic_retry":false,"provider_client_retries":0,"apify_calls":0}'::jsonb
 or not exists(select 1 from public.organization_members where organization_id=a.organization_id and user_id=(b->>'authority_user_id')::uuid and role in('owner','admin','manager'))
 or not exists(select 1 from public.establishments where id=(b->>'establishment_id')::uuid and organization_id=a.organization_id and active)
 then return false;end if;
 q=(b#>>'{ready_template,request_json}')::jsonb;packet=b#>'{ready_template,draft,packet}';manifest=b#>'{ready_template,draft,compact_wire}';
 if b#>>'{ready_template,request_sha256}' is distinct from public.jls_restaurant_hash(q)
 or b#>>'{ready_template,request_raw_sha256}' is distinct from encode(extensions.digest(b#>>'{ready_template,request_json}','sha256'),'hex')
 or q->>'model' is distinct from 'gpt-6.1-sol' or q#>>'{reasoning,effort}' is distinct from 'low' or q->>'max_output_tokens' is distinct from '9500'
 or q#>>'{input,0,role}' is distinct from 'system' or q#>>'{input,1,role}' is distinct from 'user' or jsonb_array_length(q->'input')<>2
 or q#>>'{input,0,content}' is distinct from b#>>'{ready_template,draft,prompt}' or (q#>>'{input,1,content}')::jsonb is distinct from packet
 or b#>>'{configuration,sol_prompt_sha256}' is distinct from encode(extensions.digest(q#>>'{input,0,content}','sha256'),'hex')
 or b#>>'{configuration,sol_schema_sha256}' is distinct from public.jls_restaurant_hash(q#>'{text,format,schema}')
 or b#>>'{ready_template,token_certificate_sha256}' is distinct from public.jls_restaurant_hash(b#>'{ready_template,token_certificate}')
 or b#>'{ready_template,measurement}' is distinct from b#>'{ready_template,draft,measurement}'
 or b#>>'{ready_template,measurement,input_budget_tokens}' is distinct from '32768'
 or coalesce((b#>>'{ready_template,measurement,guarded_input_tokens}')::int,-1) not between 1 and 32768
 or b#>>'{ready_template,measurement,output_reserved_tokens}' is distinct from '9500'
 or packet->>'version' is distinct from 'jls-direct4-compact-sol-v1' or packet->>'language' is distinct from 'vi'
 or manifest->>'organization_id' is distinct from b->>'organization_id' or manifest->>'establishment_id' is distinct from b->>'establishment_id'
 or manifest->>'statistics_sha256' is distinct from s->>'statistics_sha256' or manifest->>'source_snapshot_sha256' is distinct from public.jls_restaurant_hash(s->'sources')
 or manifest->>'evidence_sha256' is distinct from public.jls_restaurant_hash(s->'selected')
 or b#>>'{ready_template,draft,compact_wire_sha256}' is distinct from public.jls_restaurant_hash(manifest)
 or jsonb_array_length(packet->'associations')<>jsonb_array_length(s->'selected')
 or jsonb_array_length(manifest->'associations')<>jsonb_array_length(s->'selected')
 or (select count(distinct v->>'ref') from jsonb_array_elements(manifest->'associations')v)<>jsonb_array_length(s->'selected')
 or (select count(distinct v->>'evidence_id') from jsonb_array_elements(manifest->'associations')v)<>jsonb_array_length(s->'selected')
 or jsonb_array_length(packet->'reviews')<>(select count(distinct v->>'review_id') from jsonb_array_elements(s->'selected')v)
 or jsonb_array_length(manifest->'reviews')<>jsonb_array_length(packet->'reviews')
 or (select count(distinct v->>'ref') from jsonb_array_elements(packet->'reviews')v)<>jsonb_array_length(packet->'reviews')
 or (select count(distinct v->>'review_id') from jsonb_array_elements(manifest->'reviews')v)<>jsonb_array_length(packet->'reviews')
 then return false;end if;
 select jsonb_set(s->'statistics','{counts,categories}',jsonb_object_agg(key,value-array['positive_review_ids','negative_review_ids','mentioned_review_ids'])) into stats
 from jsonb_each(s#>'{statistics,counts,categories}');
 if packet->'statistics' is distinct from stats then return false;end if;
 for m in select value from jsonb_array_elements(manifest->'reviews') loop
  select value into r from jsonb_array_elements(s->'sources') where value->>'id'=m->>'review_id';
  select value into x from jsonb_array_elements(packet->'reviews') where value->>'ref'=m->>'ref';
  select value into meta from jsonb_array_elements(b->'review_metadata') where value->>'review_id'=m->>'review_id';
  expected=jsonb_build_object('ref',m->'ref','text',r->'analysis_text');
  if r->>'original_text' is distinct from r->>'analysis_text' then
   expected=expected||jsonb_build_object('original',r->'original_text','language',jsonb_build_object('analysis',coalesce(r->'analysis_language',meta->'analysis_language','null'::jsonb),
    'original',coalesce(r#>'{translation_provenance,original_language}',meta#>'{translation_provenance,original_language}','null'::jsonb),'source',coalesce(r->'analysis_source',meta->'translation_source')));
  end if;
  if r is null or x is distinct from expected or m->>'analysis_text_sha256' is distinct from r->>'analysis_text_sha256' or m->>'original_text_sha256' is distinct from r->>'original_text_sha256'
  or not exists(select 1 from jsonb_array_elements(s->'selected')v where v->>'review_id'=r->>'id') then return false;end if;
 end loop;
 for m in select value from jsonb_array_elements(manifest->'associations') loop
  select value into e from jsonb_array_elements(s->'selected') where value->>'evidence_id'=m->>'evidence_id';
  select value into r from jsonb_array_elements(manifest->'reviews') where value->>'review_id'=e->>'review_id';
  select value into x from jsonb_array_elements(packet->'associations') where value->>'ref'=m->>'ref';
  expected=jsonb_build_object('evidence_id',e->'evidence_id','review_id',e->'review_id','category',e->'category','polarity',e->'polarity','analysis_text_sha256',e->'analysis_text_sha256',
   'quote_sha256',e->'quote_sha256','quote_start',e->'quote_start','quote_end',e->'quote_end','context_start',e->'context_start','context_end',e->'context_end');
  if e is null or r is null or m-'ref' is distinct from expected or x is distinct from jsonb_build_object('ref',m->'ref','review',r->'ref','category',e->'category','polarity',e->'polarity') then return false;end if;
 end loop;
 return true;
exception when invalid_text_representation or invalid_parameter_value then return false;
end $$;

-- Route only opt-in compact preparations; the legacy source check stays intact.
do $$declare d text;begin
 d=pg_get_functiondef('public.check_jls_candidates_sources(jsonb)'::regprocedure);
 d=replace(d,'begin','begin if b#>>''{configuration,sol_wire_version}'' is not null then return public.check_jls_compact_comparison(b);end if;');
 execute d;
end $$;

create function public.save_jls_compact_comparison(p_body jsonb,p_sha text) returns uuid language plpgsql set search_path='' as $$
declare p public.analysis_jls_restaurant_protocols;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_sha is distinct from public.jls_restaurant_hash(p_body) or not public.check_jls_compact_comparison(p_body) then raise exception 'COMPACT_COMPARISON_SOURCE_CHANGED';end if;
 perform pg_advisory_xact_lock(hashtextextended('compact-comparison:'||(p_body#>>'{source,reference_archive,id}'),0));
 select * into p from public.analysis_jls_restaurant_protocols where body->>'version'='jls-direct4-no-luna-candidates-v1' and body#>>'{source,reference_archive,id}'=p_body#>>'{source,reference_archive,id}';
 if p.id is not null then
  if p.body#>>'{configuration,sol_wire_version}' is distinct from 'jls-direct4-compact-sol-v1' or p.body#>>'{ready_template,request_sha256}' is distinct from p_body#>>'{ready_template,request_sha256}' or p.body->>'source_sha256' is distinct from p_body->>'source_sha256' then raise exception 'COMPACT_COMPARISON_IMMUTABLE';end if;
  return p.id;
 end if;
 return public.save_jls_candidates_protocol(p_body,p_sha);
end $$;

create function public.authorize_jls_compact_comparison(p_protocol uuid,p_consent jsonb,p_sha text) returns uuid language plpgsql set search_path='' as $$
declare p public.analysis_jls_restaurant_protocols;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=p_protocol for update;
 if not public.check_jls_compact_comparison(p.body) then raise exception 'COMPACT_COMPARISON_SOURCE_CHANGED';end if;
 select id into rid from public.analysis_jls_restaurant_runs where protocol_id=p.id and consent->>'consent_source' is distinct from 'technical_qualification_no_spending';
 if rid is not null then return rid;end if;
 if (select count(*) from public.analysis_jls_snapshot_preparations where protocol_id=p.id and kind in('candidate_deployed_probe_sol','candidate_deployed_probe_validate_sol') and body->>'protocol_sha256'=p.sha256
 and body->>'provider_calls'='0' and body->'result'->>'error_code' is null and (body->'result'->>'phase'='raw_receipt_saved' or body->>'validated_report_saved'='true'))<>2 then raise exception 'COMPACT_COMPARISON_DEPLOYED_PROBE_REQUIRED';end if;
 if p_consent->'scope_resolution' is distinct from jsonb_build_object('protocol_id',p.id,'source_archive_id',p.body#>>'{source,reference_archive,id}','source_run_id',p.body#>>'{source,source_run_id}')
 or p_consent->>'experiment_version' is distinct from 'jls-direct4-compact-comparison-v1'
 or p_consent->>'request_sha256' is distinct from p.body#>>'{ready_template,request_sha256}' then raise exception 'COMPACT_COMPARISON_GO_SCOPE_CHANGED';end if;
 rid=public.authorize_jls_restaurant_pre_ready(p.id,p_consent,p_sha);
 update public.analysis_jls_restaurant_runs set stage='prepare_sol' where id=rid and status='queued' and stage='jev';
 perform public.bind_jls_candidates_ready(p.id,rid);return rid;
end $$;
revoke all on function public.check_jls_compact_comparison(jsonb),public.save_jls_compact_comparison(jsonb,text),public.authorize_jls_compact_comparison(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.check_jls_compact_comparison(jsonb),public.save_jls_compact_comparison(jsonb,text),public.authorize_jls_compact_comparison(uuid,jsonb,text) to service_role;
