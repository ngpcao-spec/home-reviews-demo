begin;
do $$declare a public.analysis_jev_pilot_evidence_v21;parent public.analysis_jev_pilot_evidence_audits;bad boolean;id2 uuid;begin
 select * into a from public.analysis_jev_pilot_evidence_v21 order by created_at desc limit 1;if not found then raise exception 'TEST_V21_REQUIRED';end if;
 select * into parent from public.analysis_jev_pilot_evidence_audits where id=a.base_audit_id;
 if a.base_result_sha256<>parent.result_sha256 or a.human_validated or a.ai_verified or a.new_paid_calls<>0 or a.production_enabled then raise exception 'TEST_V21_PROVENANCE';end if;
 if has_table_privilege('anon','public.analysis_jev_pilot_evidence_v21','select') or has_table_privilege('authenticated','public.analysis_jev_pilot_evidence_v21','insert') or has_function_privilege('authenticated','public.save_pilot_evidence_v21(uuid,uuid,jsonb,text)','execute') then raise exception 'TEST_PRIVILEGES';end if;
 id2=public.save_pilot_evidence_v21(a.created_by,a.base_audit_id,a.result,a.result_sha256);if id2<>a.id then raise exception 'TEST_IDEMPOTENCE';end if;
 bad=false;begin update public.analysis_jev_pilot_evidence_v21 set result='{}' where id=a.id;exception when others then if sqlerrm='EVIDENCE_AUDIT_IMMUTABLE' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_IMMUTABLE';end if;
 bad=false;begin perform public.save_pilot_evidence_v21(gen_random_uuid(),a.base_audit_id,a.result,a.result_sha256);exception when others then if sqlerrm='FORBIDDEN' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_ROLE';end if;
 bad=false;begin perform public.save_pilot_evidence_v21(a.created_by,a.base_audit_id,a.result,repeat('a',64));exception when others then if sqlerrm='EVIDENCE_V21_HASH_CHANGED' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_HASH';end if;
 if jsonb_array_length(a.result->'selected')<>8 or (a.result->'summary'->>'grounded_recommendations')::int<>4 then raise exception 'TEST_REAL_PROOF_RECOMMENDATIONS';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d6e79d9c-72cd-40d2-a945-0452b268a783',true);
do $$begin if not exists(select 1 from public.analysis_jev_pilot_evidence_v21) then raise exception 'TEST_OWNER_RLS';end if;end $$;
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
do $$begin if exists(select 1 from public.analysis_jev_pilot_evidence_v21) then raise exception 'TEST_CROSS_TENANT';end if;end $$;
rollback;
