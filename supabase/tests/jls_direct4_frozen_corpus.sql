-- Read-only source/ACL regression. No consent, run, task, HTTP or provider.
begin;
set local role service_role;
do $$declare p public.analysis_jls_restaurant_protocols;b jsonb;v jsonb;rid uuid;begin
 select * into p from public.analysis_jls_restaurant_protocols where body->>'version'='jls-direct4-frozen-corpus-v1' order by created_at desc limit 1;
 if p.id is null or not public.check_jls_direct4_historical_sources(p.body) then raise exception 'FROZEN_CORPUS_INVALID';end if;
 if public.save_jls_restaurant_protocol(p.body,p.sha256)<>p.id then raise exception 'PROTOCOL_NOT_IDEMPOTENT';end if;
 for v in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_set(p.body,'{establishment_id}','"00000000-0000-4000-8000-000000000001"'),
  jsonb_set(p.body,'{organization_id}','"00000000-0000-4000-8000-000000000002"'),
  jsonb_set(p.body,'{source_snapshot,reviews,0,id}','"00000000-0000-4000-8000-000000000003"'),
  jsonb_set(p.body,'{source_snapshot,reviews,0,analysis_text}','"different corpus"'),
  jsonb_set(p.body,'{denominators,analytical_reviews}','68'),
  jsonb_set(p.body,'{max_jev_calls}',to_jsonb((p.body->>'max_jev_calls')::int+1)),
  jsonb_set(p.body,'{max_luna_calls}','33'),jsonb_set(p.body,'{max_sol_calls}','2'),
  jsonb_set(p.body,'{classification_configuration_sha256}','"changed"'),
  jsonb_set(p.body,'{configuration,synthesis_version}','"changed"'),
  jsonb_set(p.body,'{source_snapshot,reviews,0,translation_provenance,source}','"invented"')
 )) loop
  if public.check_jls_direct4_historical_sources(v) then raise exception 'INVALID_SOURCE_ACCEPTED';end if;
  begin perform public.save_jls_restaurant_protocol(v,public.jls_restaurant_hash(v));raise exception 'INVALID_PROTOCOL_SAVED';
  exception when others then if sqlerrm<>'DIRECT4_HISTORICAL_PROTOCOL_INVALID' then raise;end if;end;
 end loop;
 for b in select body from public.analysis_jls_restaurant_protocols where body->>'version'='jls-direct4-historical-v1' loop
  if not public.check_jls_direct4_historical_sources(b) then raise exception 'LEGACY_SOURCE_REGRESSION';end if;
 end loop;
 begin perform public.authorize_jls_restaurant(p.id,null,null);raise exception 'MISSING_GO_ACCEPTED';
 exception when others then if sqlerrm not in('DIRECT4_HISTORICAL_DEPLOYED_QUALIFICATION_REQUIRED','DIRECT4_HISTORICAL_GO_SCOPE_CHANGED','JLS_NEW_GO_REQUIRED') then raise;end if;end;
 begin update public.analysis_jls_restaurant_protocols set body=jsonb_set(body,'{max_sol_calls}','2') where id=p.id;raise exception 'PROTOCOL_MUTABLE';
 exception when others then if sqlerrm<>'JLS_HISTORY_IMMUTABLE' then raise;end if;end;
 select id into rid from public.analysis_jls_restaurant_runs where protocol_id=p.id;
 if rid is not null then raise exception 'UNEXPECTED_PAID_RUN';end if;
 perform set_config('direct4_corpus_test.user',p.authority_user_id::text,true);perform set_config('direct4_corpus_test.protocol',p.id::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('direct4_corpus_test.user'),true);
do $$begin
 if not exists(select 1 from public.analysis_jls_restaurant_protocols where id=current_setting('direct4_corpus_test.protocol')::uuid) then raise exception 'OWNER_READ_FAILED';end if;
 if has_function_privilege('authenticated','public.save_jls_restaurant_protocol(jsonb,text)','execute')
 or has_function_privilege('authenticated','public.check_jls_direct4_frozen_sources(jsonb)','execute')
 or has_function_privilege('anon','public.claim_jls_restaurant_task(uuid,text)','execute') then raise exception 'PUBLIC_SERVER_WRITE';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
do $$begin
 if exists(select 1 from public.analysis_jls_restaurant_protocols where id=current_setting('direct4_corpus_test.protocol')::uuid) then raise exception 'CROSS_ORG_READ';end if;
end $$;
rollback;
