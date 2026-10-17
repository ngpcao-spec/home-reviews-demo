-- Preserve exact JS UTF-16 offsets when English reviews contain emoji.
create function public.jls_snapshot_quote_matches(p_text text,p_start int,p_end int,p_quote text)
returns boolean language sql immutable strict set search_path='' as $f$
 with units as(select ch,n,sum(case when ascii(ch)>65535 then 2 else 1 end)over(order by n) stop,
 case when ascii(ch)>65535 then 2 else 1 end width
 from regexp_split_to_table(p_text,'')with ordinality a(ch,n))
 select coalesce(p_start>=0 and p_end>p_start and string_agg(ch,'' order by n)=p_quote
 and min(stop-width)=p_start and max(stop)=p_end,false) from units where stop>p_start and stop<=p_end
$f$;
revoke all on function public.jls_snapshot_quote_matches(text,int,int,text) from public,anon,authenticated;
grant execute on function public.jls_snapshot_quote_matches(text,int,int,text) to service_role;
create or replace function public.bind_jls_snapshot_preparation(p_run uuid,p_stage text,p_body jsonb,p_sha text) returns boolean language plpgsql security invoker set search_path='' set jit='off' as $fn$
declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;w text='codex_free_preparation_v1';v jsonb;plan jsonb;aid uuid;tid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run for update;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if p_stage='prepare_evidence' and exists(select 1 from public.analysis_jls_restaurant_artifacts where run_id=r.id and kind='snapshot_evidence' and sha256=p_sha) then return true;end if;
 if p_stage='prepare_sol' and exists(select 1 from public.analysis_jls_sol_ready_artifacts where source_run_id=r.id and sha256=p_sha) then return true;end if;
 if p.body->>'version'<>'jls-historical-snapshot-v2-vi-v1' or r.stage<>p_stage or p_sha<>public.jls_restaurant_hash(p_body)
 or not public.check_jls_snapshot_v2_source(p.body) or not public.claim_jls_restaurant_tick(r.id,w) then return false;end if;
 if p_stage='prepare_evidence' then
 plan=p_body->'plan';
 if p_body->>'protocol_sha256'<>p.sha256 or p_body->>'plan_sha256'<>public.jls_restaurant_hash(plan)
 or jsonb_array_length(plan->'cache_fingerprints')<>80 or plan->'statistics'->'coverage'->>'analysed_reviews'<>'80'
 or plan->'statistics'->'coverage'->>'stored_reviews'<>'100' or (plan->>'question_count')::int>32 or jsonb_array_length(plan->'luna_groups')>32 then raise exception 'JLS_EVIDENCE_INVALID';end if;
 if (select count(distinct value->>'review_id') from jsonb_array_elements(plan->'cache_fingerprints'))<>80 or exists(
 select 1 from jsonb_array_elements(plan->'cache_fingerprints')x left join public.analysis_jev_review_cache c on c.id=(x->>'cache_id')::uuid
 where c.id is null or c.status<>'completed' or c.organization_id<>p.organization_id or c.establishment_id<>p.establishment_id
 or c.analysis_text_sha256<>x->>'text_sha256' or x->>'response_sha256'<>public.jls_restaurant_hash(jsonb_build_object('cache_key',c.cache_key,'response',c.response,'theme_results',c.theme_results,'served_model',c.served_model)))
 then raise exception 'JLS_COMPLETED_CACHE_REQUIRED_NO_MOCK';end if;
 for v in select value from jsonb_array_elements(plan->'statistics'->'themes') loop
 if (v->>'negative_reviews')::int<>(select count(distinct c.review_id) from public.analysis_jev_review_cache c where c.id in(select (x->>'cache_id')::uuid from jsonb_array_elements(plan->'cache_fingerprints')x) and c.theme_results->(v->>'theme_key')->>'choice' in('negative','both'))
 or (v->>'positive_reviews')::int<>(select count(distinct c.review_id) from public.analysis_jev_review_cache c where c.id in(select (x->>'cache_id')::uuid from jsonb_array_elements(plan->'cache_fingerprints')x) and c.theme_results->(v->>'theme_key')->>'choice' in('positive','both'))
 then raise exception 'JLS_THEME_FREQUENCY_CHANGED';end if;end loop;
 for v in select value from jsonb_array_elements(plan->'selected') loop
 if not exists(select 1 from jsonb_array_elements(p.body->'snapshot'->'source'->'reviews')s where s->>'id'=v->>'review_id'
 and s->>'analysis_text_sha256'=v->>'analysis_text_sha256' and public.jls_snapshot_quote_matches(s->>'analysis_text',(v->>'quote_start')::int,(v->>'quote_end')::int,v->>'quote') and public.jls_snapshot_quote_matches(s->>'analysis_text',(v->>'context_start')::int,(v->>'context_end')::int,v->>'context')
 and v->>'quote_sha256'=encode(extensions.digest(v->>'quote','sha256'),'hex')) then raise exception 'JLS_QUOTE_CHANGED';end if;end loop;
 if not public.save_jls_restaurant_artifact(r.id,w,'snapshot_evidence',p_body,p_sha) or not public.save_jls_restaurant_artifact(r.id,w,'evidence_plan',plan,public.jls_restaurant_hash(plan)) then raise exception 'JLS_BIND_FAILED';end if;
 if not public.stage_jls_snapshot_v2(r.id,w,'luna',(select jsonb_agg(jsonb_build_object('review_id',g->'review_id','request',g->'payload','request_sha256',g->'request_sha256')) from jsonb_array_elements(plan->'luna_groups')g)) then raise exception 'JLS_STAGE_CHANGED';end if;
 elsif p_stage='prepare_sol' then
 if p_body->>'version'<>'jls-snapshot-sol-request-v2' or not public.check_jls_snapshot_ready_sources(p_body)
 or p_body->'sol'->'gate'->>'passed'<>'true' or p_body->'sol'->'draft'->>'format_version'<>'jls-prioritized-recommendations-v2'
 or p_body->'sol'->'draft'->>'prompt_sha256'<>p.body->'configuration'->>'sol_prompt_sha256'
 or p_body->'sol'->'draft'->>'schema_sha256'<>p.body->'configuration'->>'sol_schema_sha256'
 or p_body->>'request_raw_sha256'<>encode(extensions.digest(p_body->>'request_json','sha256'),'hex')
 or p_body->>'request_sha256'<>public.jls_restaurant_hash((p_body->>'request_json')::jsonb)
 or p_body->'measurement'->>'input_budget_tokens'<>'32768' or (p_body->'measurement'->>'guarded_input_tokens')::int>32768
 or p_body->'measurement'->>'output_reserved_tokens'<>'9500' or octet_length(p_body->>'request_json')>1048576
 then raise exception 'JLS_SOL_READY_INVALID';end if;
 insert into public.analysis_jls_sol_ready_artifacts(organization_id,source_protocol_id,source_run_id,body,sha256)
 values(p.organization_id,p.id,r.id,p_body,p_sha) returning id into aid;
 insert into public.analysis_jls_restaurant_tasks(run_id,organization_id,phase,task_key,request,request_sha256)
 values(r.id,r.organization_id,'sol','sol',(p_body->>'request_json')::jsonb,p_body->>'request_sha256')returning id into tid;
 insert into public.analysis_jls_sol_ready_operations(organization_id,artifact_id,mode,protocol_id,protocol_sha256,run_id,task_id)
 values(p.organization_id,aid,'paid',p.id,p.sha256,r.id,tid);
 update public.analysis_jls_restaurant_runs set stage='sol' where id=r.id;
 else raise exception 'JLS_FREE_STAGE_INVALID';end if;
 perform public.release_jls_restaurant_tick(r.id,w,null);return true;
end $fn$;

