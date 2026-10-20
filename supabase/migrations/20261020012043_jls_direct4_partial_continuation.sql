-- Free protocol preparation only. No consent, paid run, task or dispatch.
create function public.check_jls_direct4_partial_sources(b jsonb) returns boolean
language plpgsql stable set search_path='' set jit='off' as $$
declare c jsonb=b->'continuation';p public.analysis_jls_restaurant_protocols;r public.analysis_jls_restaurant_runs;fix public.analysis_jls_snapshot_preparations;
 x jsonb;y jsonb;original jsonb;actual jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_restaurant_protocols where id=(c->>'source_protocol_id')::uuid;
 select * into r from public.analysis_jls_restaurant_runs where id=(c->>'source_run_id')::uuid;
 select * into fix from public.analysis_jls_snapshot_preparations where id=(c->'fix_archive'->>'id')::uuid;
 original=(b-'continuation')||jsonb_build_object('pending',c->'original_pending','pending_sha256',public.jls_restaurant_hash(c->'original_pending'),
  'max_jev_calls',jsonb_array_length(c->'original_pending'),'code_provenance',c->'source_code_provenance');
 if not coalesce(c->>'version'='jls-direct4-partial-continuation-v1' and c->>'new_consent_required'='true'
 and p.body->>'version'='jls-direct4-frozen-corpus-v1' and not(p.body?'continuation') and original=p.body and p.sha256=c->>'source_protocol_sha256'
 and public.jls_restaurant_hash(p.body)=p.sha256 and public.check_jls_direct4_frozen_sources(p.body)
 and b->>'code_provenance' ~ '^[a-f0-9]{40}$' and r.protocol_id=p.id and r.organization_id=p.organization_id
 and r.status in('billing_uncertain','blocked','needs_review','authorization_expired') and public.jls_restaurant_hash(to_jsonb(r))=c->>'source_run_sha256'
 and fix.protocol_id=p.id and fix.organization_id=p.organization_id and fix.sha256=c->'fix_archive'->>'sha256'
 and fix.sha256=public.jls_restaurant_hash(fix.body) and fix.body->>'source_run'=r.id::text
 and fix.body->>'version'='jls-restaurant-receipt-v1'
 and b->>'pending_sha256'=public.jls_restaurant_hash(b->'pending') and (b->>'max_jev_calls')::int=jsonb_array_length(b->'pending')
 and (c->>'expected_analysed_reviews')::int=jsonb_array_length(b->'pending')+jsonb_array_length(c->'reused')
 and (c->>'technical_missing_reviews')::int=jsonb_array_length(c->'missing')
 and (c->>'expected_analysed_reviews')::int+(c->>'technical_missing_reviews')::int=(b->'denominators'->>'analytical_reviews')::int,false) then return false;end if;
 select jsonb_agg(to_jsonb(t) order by t.id) into actual from public.analysis_jls_restaurant_tasks t where run_id=r.id;
 if public.jls_restaurant_hash(actual) is distinct from c->>'source_tasks_sha256' then return false;end if;
 select jsonb_agg(jsonb_build_object('task_id',id,'review_id',review_id,'request_sha256',request_sha256,'status',status,'request_count',request_count) order by id)
 into actual from public.analysis_jls_restaurant_tasks where run_id=r.id;
 if actual is distinct from c->'source_tasks' then return false;end if;
 select jsonb_agg(jsonb_build_object('kind',kind,'body',body,'sha256',sha256) order by kind) into actual from public.analysis_jls_restaurant_artifacts where run_id=r.id;
 if public.jls_restaurant_hash(actual) is distinct from c->>'source_artifacts_sha256' then return false;end if;
 select jsonb_agg(v->>'review_id' order by v->>'review_id') into actual from jsonb_array_elements((b->'pending')||(c->'reused')||(c->'missing')) v;
 if jsonb_array_length(actual)<>jsonb_array_length(p.body->'pending') or
 (select count(distinct v->>'review_id') from jsonb_array_elements((b->'pending')||(c->'reused')||(c->'missing'))v)<>jsonb_array_length(p.body->'pending') or
 actual is distinct from (select jsonb_agg(v->>'review_id' order by v->>'review_id') from jsonb_array_elements(p.body->'pending')v) then return false;end if;
 for x in select value from jsonb_array_elements(b->'pending') loop
  if not exists(select 1 from public.analysis_jls_restaurant_tasks t where t.run_id=r.id and t.review_id=(x->>'review_id')::uuid
   and t.phase='jev' and t.status='pending' and t.request_count=0 and t.request_sha256=x->>'request_sha256')
   or not exists(select 1 from jsonb_array_elements(p.body->'pending')y where y=x) then return false;end if;
 end loop;
 for x in select value from jsonb_array_elements(c->'reused') loop
  if not exists(select 1 from public.analysis_jls_restaurant_tasks t join public.analysis_jls_restaurant_artifacts a on a.run_id=t.run_id and a.kind='task:'||t.id
   where t.run_id=r.id and t.id=(x->>'task_id')::uuid and t.review_id=(x->>'review_id')::uuid and t.phase='jev' and t.status='completed' and t.request_count=1
   and t.request_sha256=x->>'request_sha256' and a.sha256=x->>'artifact_sha256' and a.body=x->'body' and public.jls_restaurant_hash(a.body)=a.sha256
   and a.body->>'phase'='jev' and a.body->>'request_sha256'=t.request_sha256 and a.body->>'raw_response_text' is not null
   and a.body->>'raw_response_sha256'=encode(extensions.digest(a.body->>'raw_response_text','sha256'),'hex')) then return false;end if;
 end loop;
 for x in select value from jsonb_array_elements(c->'missing') loop
  if not exists(select 1 from public.analysis_jls_restaurant_tasks t where t.run_id=r.id and t.id=(x->>'task_id')::uuid and t.review_id=(x->>'review_id')::uuid
   and t.phase='jev' and t.status='running' and t.request_count=1 and t.request_sha256=x->>'request_sha256'
   and not exists(select 1 from public.analysis_jls_restaurant_artifacts a where a.run_id=r.id and a.kind='task:'||t.id))
   or x->'result' is distinct from 'null'::jsonb or x->>'reason' is distinct from 'reserved_outcome_unknown_no_retry'
   or not exists(select 1 from jsonb_array_elements(p.body->'source_snapshot'->'reviews')y where y->>'id'=x->>'review_id' and y=x->'source') then return false;end if;
 end loop;return true;
 exception when invalid_text_representation or null_value_not_allowed then return false;
end $$;
revoke all on function public.check_jls_direct4_partial_sources(jsonb) from public,anon,authenticated;
grant execute on function public.check_jls_direct4_partial_sources(jsonb) to service_role;
create unique index jls_one_partial_continuation_per_source_run on public.analysis_jls_restaurant_protocols((body->'continuation'->>'source_run_id')) where body->>'version'='jls-direct4-frozen-corpus-v1' and body->'continuation'->>'version'='jls-direct4-partial-continuation-v1';

-- Existing version routing, worker, authorization, task reservation and Sol
-- receipt machinery remain in use. Only the partial-corpus binding differs.
do $adapt$ declare d text;before text;after text;begin
 d=pg_get_functiondef('public.check_jls_direct4_frozen_sources(jsonb)'::regprocedure);
 before='if current_user<>''service_role'' then raise exception ''FORBIDDEN'';end if;';
 if position(before in d)=0 then raise exception 'PARTIAL_SOURCE_ROUTE_NOT_FOUND';end if;
 execute replace(d,before,before||' if b?''continuation'' then return public.check_jls_direct4_partial_sources(b);end if;');
 d=pg_get_functiondef('public.bind_jls_direct4_historical_evidence(uuid,jsonb,text)'::regprocedure);
 before='jsonb_build_object(''source_reviews'',p.body->''denominators''->''source_reviews'',''analysed_text_reviews'',p.body->''denominators''->''analytical_reviews'',''textless_statistics_only'',p.body->''denominators''->''textless_statistics_only'')';
 after='(jsonb_build_object(''source_reviews'',p.body->''denominators''->''source_reviews'',''analysed_text_reviews'',coalesce(p.body->''continuation''->''expected_analysed_reviews'',p.body->''denominators''->''analytical_reviews''),''textless_statistics_only'',p.body->''denominators''->''textless_statistics_only'')||case when p.body?''continuation'' then jsonb_build_object(''technical_missing_reviews'',p.body->''continuation''->''technical_missing_reviews'',''textual_source_reviews'',p.body->''denominators''->''analytical_reviews'') else ''{}''::jsonb end)';
 if position(before in d)=0 then raise exception 'PARTIAL_STATISTICS_BINDING_NOT_FOUND';end if;d=replace(d,before,after);
 before='(p.body->>''max_jev_calls'')::int';after='coalesce((p.body->''continuation''->>''expected_analysed_reviews'')::int,(p.body->>''max_jev_calls'')::int)';
 if position(before in d)=0 then raise exception 'PARTIAL_ROW_BINDING_NOT_FOUND';end if;d=replace(d,before,after);
 before='t.run_id=r.id and t.phase=''jev''';
 after='t.organization_id=r.organization_id and (t.run_id=r.id or (t.run_id=(p.body->''continuation''->>''source_run_id'')::uuid and exists(select 1 from jsonb_array_elements(p.body->''continuation''->''reused'') z where z->>''task_id''=t.id::text and z->>''artifact_sha256''=a.sha256))) and t.phase=''jev''';
 if position(before in d)=0 then raise exception 'PARTIAL_REUSE_BINDING_NOT_FOUND';end if;d=replace(d,before,after);
 before='for v in select value from jsonb_array_elements(p_body->''jev_source_tasks'') loop';
 after='if (select count(distinct value->>''task_id'') from jsonb_array_elements(p_body->''jev_source_tasks''))<>jsonb_array_length(p_body->''jev_source_tasks'') or (select count(distinct value->>''review_id'') from jsonb_array_elements(p_body->''dataset''->''body''->''reviews''))<>jsonb_array_length(p_body->''dataset''->''body''->''reviews'') then return false;end if; '||before;
 if position(before in d)=0 then raise exception 'PARTIAL_UNIQUENESS_BINDING_NOT_FOUND';end if;execute replace(d,before,after);
end $adapt$;
