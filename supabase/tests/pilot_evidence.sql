-- Rollback-only checks against the separately saved free audit; no HTTP/provider calls.
begin;
do $$declare a public.analysis_jev_pilot_evidence_audits;id2 uuid;bad boolean;begin
 select * into a from public.analysis_jev_pilot_evidence_audits order by created_at desc limit 1;if not found then raise exception 'TEST_FREE_EVIDENCE_AUDIT_REQUIRED';end if;
 if not exists(select 1 from pg_class where oid='public.analysis_jev_pilot_evidence_audits'::regclass and relrowsecurity) or has_table_privilege('anon','public.analysis_jev_pilot_evidence_audits','select') or has_table_privilege('authenticated','public.analysis_jev_pilot_evidence_audits','insert') or has_table_privilege('authenticated','public.analysis_jev_pilot_evidence_audits','update') or has_table_privilege('authenticated','public.analysis_jev_pilot_evidence_audits','delete') or has_function_privilege('authenticated','public.save_pilot_evidence_audit(uuid,uuid,uuid,jsonb,text)','execute') then raise exception 'TEST_PRIVILEGES';end if;
 id2=public.save_pilot_evidence_audit(a.created_by,a.snapshot_id,a.report_id,a.result,a.result_sha256);if id2<>a.id then raise exception 'TEST_IDEMPOTENCE';end if;
 if a.human_validated or a.ai_verified or a.new_paid_calls<>0 or a.production_enabled or a.verification_type<>'deterministic_rule_check' then raise exception 'TEST_PROVENANCE';end if;
 bad=false;begin update public.analysis_jev_pilot_evidence_audits set result='{}' where id=a.id;exception when others then if sqlerrm='EVIDENCE_AUDIT_IMMUTABLE' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_UPDATE_IMMUTABILITY';end if;
 bad=false;begin delete from public.analysis_jev_pilot_evidence_audits where id=a.id;exception when others then if sqlerrm='EVIDENCE_AUDIT_IMMUTABLE' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_DELETE_IMMUTABILITY';end if;
 bad=false;begin perform public.save_pilot_evidence_audit(gen_random_uuid(),a.snapshot_id,a.report_id,a.result,a.result_sha256);exception when others then if sqlerrm='FORBIDDEN' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_CROSS_TENANT';end if;
 bad=false;begin perform public.save_pilot_evidence_audit(a.created_by,a.snapshot_id,a.report_id,a.result,repeat('a',64));exception when others then if sqlerrm='EVIDENCE_HASH_CHANGED' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_HASH';end if;
 bad=false;begin perform public.save_pilot_evidence_audit(a.created_by,a.snapshot_id,a.report_id,jsonb_set(a.result,'{independent_human_validation}','true'),a.result_sha256);exception when others then if sqlerrm='EVIDENCE_SOURCE_CHANGED' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_NO_HUMAN_CLAIM';end if;
 if (a.result->'summary'->>'jev_reviews')::int<>(select (input_context->'statistics'->'coverage'->>'analysed_reviews')::int from public.analysis_jev_pilot_jobs where id=a.report_id) then raise exception 'TEST_COUNT_INTEGRITY';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d6e79d9c-72cd-40d2-a945-0452b268a783',true);
do $$begin if not exists(select 1 from public.analysis_jev_pilot_evidence_audits) then raise exception 'TEST_OWNER_RLS';end if;end $$;
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
do $$begin if exists(select 1 from public.analysis_jev_pilot_evidence_audits) then raise exception 'TEST_CROSS_TENANT_RLS';end if;end $$;
rollback;
