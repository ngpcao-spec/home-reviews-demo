begin;
do $$declare a public.analysis_jev_pilot_evidence_v3_reserved_evaluations;bad boolean;id2 uuid;begin
 select * into a from public.analysis_jev_pilot_evidence_v3_reserved_evaluations order by created_at desc limit 1;if not found then raise exception 'TEST_EVALUATION_REQUIRED';end if;
 if a.human_validated or a.production_enabled or a.new_paid_calls<>0 or a.result->>'reference_type'<>'chatgpt_ai_reference_not_human_gold' then raise exception 'TEST_SCOPE';end if;
 if jsonb_array_length(a.result->'cases')<>40 or (a.result->'metrics'->'v3'->>'comparable')::int<>36 or (a.result->'metrics'->'v3'->'counts'->>'reference_uncertain')::int<>4 then raise exception 'TEST_METRICS';end if;
 if has_table_privilege('anon','public.analysis_jev_pilot_evidence_v3_reserved_evaluations','select') or has_table_privilege('authenticated','public.analysis_jev_pilot_evidence_v3_reserved_evaluations','insert') or has_function_privilege('authenticated','public.save_pilot_reserved_evaluation(uuid,uuid,jsonb,text)','execute') then raise exception 'TEST_PRIVILEGES';end if;
 id2=public.save_pilot_reserved_evaluation(a.created_by,a.control_id,a.result,a.result_sha256);if id2<>a.id then raise exception 'TEST_IDEMPOTENCE';end if;
 bad=false;begin update public.analysis_jev_pilot_evidence_v3_reserved_evaluations set result='{}' where id=a.id;exception when others then if sqlerrm='EVIDENCE_AUDIT_IMMUTABLE' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_IMMUTABLE';end if;
 bad=false;begin perform public.save_pilot_reserved_evaluation(gen_random_uuid(),a.control_id,a.result,a.result_sha256);exception when others then if sqlerrm='FORBIDDEN' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_ROLE';end if;
 bad=false;begin perform public.save_pilot_reserved_evaluation(a.created_by,a.control_id,a.result,repeat('a',64));exception when others then if sqlerrm='RESERVED_EVALUATION_HASH_CHANGED' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_HASH';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d6e79d9c-72cd-40d2-a945-0452b268a783',true);
do $$begin if not exists(select 1 from public.analysis_jev_pilot_evidence_v3_reserved_evaluations) then raise exception 'TEST_OWNER_RLS';end if;end $$;
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
do $$begin if exists(select 1 from public.analysis_jev_pilot_evidence_v3_reserved_evaluations) then raise exception 'TEST_CROSS_TENANT';end if;end $$;
rollback;
