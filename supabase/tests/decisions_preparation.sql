begin;
do $$declare e public.analysis_decisions_experiments;id2 uuid;bad boolean;begin
 select * into e from public.analysis_decisions_experiments limit 1;
 if e.id is null or e.paid_enabled or e.production_enabled or jsonb_array_length(e.body->'reviews')<>32 or jsonb_array_length(e.body->'requests')<>64 or (e.body->>'uncertain_reference_count')::int<>16 then raise exception 'DECISIONS_TEST_SOURCE';end if;
 if has_table_privilege('anon','public.analysis_decisions_experiments','select') or has_table_privilege('authenticated','public.analysis_decisions_tasks','insert') or has_function_privilege('authenticated','public.save_decisions_preparation(uuid,jsonb,text)','execute') then raise exception 'DECISIONS_TEST_GRANTS';end if;
 id2:=public.save_decisions_preparation(e.created_by,e.body,e.result_sha256);if id2<>e.id then raise exception 'DECISIONS_TEST_IDEMPOTENCE';end if;
 if (select count(*) from public.analysis_decisions_configurations)<>3 or exists(select 1 from public.analysis_decisions_tasks) or exists(select 1 from public.analysis_decisions_results) then raise exception 'DECISIONS_TEST_NO_JOB';end if;
 bad:=false;begin update public.analysis_decisions_experiments set paid_enabled=true where id=e.id;exception when others then if sqlerrm='EVIDENCE_AUDIT_IMMUTABLE' then bad:=true;else raise;end if;end;if not bad then raise exception 'DECISIONS_TEST_IMMUTABLE';end if;
 bad:=false;begin perform public.save_decisions_preparation('ffffffff-ffff-4fff-8fff-ffffffffffff',e.body,e.result_sha256);exception when others then if sqlerrm='FORBIDDEN' then bad:=true;else raise;end if;end;if not bad then raise exception 'DECISIONS_TEST_MEMBER';end if;
 bad:=false;begin perform public.save_decisions_preparation(e.created_by,jsonb_set(e.body,'{new_paid_calls}','1'),e.result_sha256);exception when others then if sqlerrm='DECISIONS_SCOPE_CHANGED' then bad:=true;else raise;end if;end;if not bad then raise exception 'DECISIONS_TEST_PAID_DISABLED';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d6e79d9c-72cd-40d2-a945-0452b268a783',true);
do $$begin if (select count(*) from public.analysis_decisions_experiments)<>1 then raise exception 'DECISIONS_TEST_OWNER';end if;end $$;
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
do $$begin if exists(select 1 from public.analysis_decisions_experiments) or exists(select 1 from public.analysis_decisions_configurations) then raise exception 'DECISIONS_TEST_CROSS_TENANT';end if;end $$;
rollback;
