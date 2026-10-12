begin;
do $$declare p public.analysis_jev_hybrid_plans;c public.analysis_jev_hybrid_controls;a uuid;j uuid;bad boolean;pid uuid;begin
 select * into p from public.analysis_jev_hybrid_plans where language='fr' and version='jev-hybrid-evidence-report-v1' limit 1;select * into c from public.analysis_jev_hybrid_controls where organization_id=p.organization_id;
 if p.id is null or jsonb_array_length(p.body->'selected')>32 or (p.body->'analytics'->'coverage'->>'analysed_reviews')::int<>422 or p.paid_enabled or p.production_enabled then raise exception 'TEST_PLAN';end if;
 if has_table_privilege('anon','public.analysis_jev_hybrid_plans','select') or has_table_privilege('authenticated','public.analysis_jev_hybrid_authorizations','insert') or has_function_privilege('authenticated','public.save_hybrid_preparation(uuid,uuid,jsonb,text,jsonb,text)','execute') then raise exception 'TEST_PRIVILEGES';end if;
 pid=public.save_hybrid_preparation(p.created_by,p.source_snapshot_id,p.body,p.result_sha256,c.body,c.result_sha256);if pid<>p.id then raise exception 'TEST_IDEMPOTENCE';end if;
 -- Runs the independent SQL integrity trigger on existing preparation, discards duplicate.
 insert into public.analysis_jev_hybrid_plans select gen_random_uuid(),organization_id,establishment_id,source_snapshot_id,version,language,source_sha256,dossier_sha256,prompt_sha256,schema_sha256,statistics_sha256,result_sha256,body,paid_enabled,production_enabled,created_by,created_at from public.analysis_jev_hybrid_plans where id=p.id on conflict do nothing;
 bad=false;begin update public.analysis_jev_hybrid_plans set body='{}' where id=p.id;exception when others then if sqlerrm='EVIDENCE_AUDIT_IMMUTABLE' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_IMMUTABLE';end if;
 bad=false;begin perform public.start_hybrid_report(p.id,true);exception when others then if sqlerrm='HYBRID_PAID_EXECUTION_DISABLED' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_SPENDING_DISABLED';end if;
 bad=false;begin perform public.save_hybrid_preparation(gen_random_uuid(),p.source_snapshot_id,p.body,p.result_sha256,c.body,c.result_sha256);exception when others then if sqlerrm='FORBIDDEN' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_MEMBER';end if;
 -- Blocked mock rows exist only inside this rolled-back SQL test, never grant spending.
 insert into public.analysis_jev_hybrid_authorizations(organization_id,plan_id,max_cost_usd,plan_sha256,dossier_sha256,prompt_sha256,schema_sha256,created_by) values(p.organization_id,p.id,0,p.result_sha256,p.dossier_sha256,p.prompt_sha256,p.schema_sha256,p.created_by) returning id into a;
 insert into public.analysis_jev_hybrid_jobs(organization_id,plan_id,authorization_id,language,status,request_count,lease_owner,lease_until,dossier_sha256,prompt_sha256,schema_sha256,created_by) values(p.organization_id,p.id,a,'fr','running',1,'mock-worker',now()+interval '1 minute',p.dossier_sha256,p.prompt_sha256,p.schema_sha256,p.created_by) returning id into j;
 bad=false;begin update public.analysis_jev_hybrid_jobs set status='queued' where id=j;exception when others then if sqlerrm='HYBRID_NO_PAID_RETRY' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_RETRY';end if;
 update public.analysis_jev_hybrid_jobs set status='billing_uncertain' where id=j;
 bad=false;begin update public.analysis_jev_hybrid_jobs set status='running' where id=j;exception when others then if sqlerrm='HYBRID_NO_PAID_RETRY' then bad=true;else raise;end if;end;if not bad then raise exception 'TEST_AMBIGUOUS_NO_RETRY';end if;
 if jsonb_array_length(c.body->'items')<>40 or (c.body->>'reference_labels')::int<>0 or (c.body->>'missing_jev')::int<>40 then raise exception 'TEST_CONTROL';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d6e79d9c-72cd-40d2-a945-0452b268a783',true);
do $$begin if (select count(*) from public.analysis_jev_hybrid_plans where version='jev-hybrid-evidence-report-v1')<>2 then raise exception 'TEST_OWNER_RLS';end if;end $$;
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
do $$begin if exists(select 1 from public.analysis_jev_hybrid_plans) or exists(select 1 from public.analysis_jev_hybrid_controls) then raise exception 'TEST_CROSS_TENANT';end if;end $$;
rollback;
