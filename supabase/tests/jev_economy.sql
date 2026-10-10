-- All writes are to NEW economy tables and rolled back. No provider or historic mutation.
begin;
do $$ declare c record;u uuid;r record;i jsonb;a jsonb;b jsonb;blocked boolean;begin
 if (select count(*) from public.analysis_jev_economy_configurations)<>2 then raise exception 'CONFIGURATION_COUNT';end if;
 if exists(select 1 from pg_class where oid in ('public.analysis_jev_review_cache'::regclass,'public.analysis_jev_economy_comparisons'::regclass) and not relrowsecurity) then raise exception 'RLS_MISSING';end if;
 if has_function_privilege('authenticated','public.reserve_jev_economy_cache(uuid,jsonb)','execute') or has_table_privilege('anon','public.analysis_jev_review_cache','select') or has_table_privilege('authenticated','public.analysis_jev_review_cache','insert') then raise exception 'PRIVILEGE_LEAK';end if;
 select * into c from public.analysis_jev_economy_configurations where id='v12_economy_1pass_v1';
 select rr.id,rr.establishment_id,e.organization_id into r from public.reviews rr join public.establishments e on e.id=rr.establishment_id join public.organization_members m on m.organization_id=e.organization_id and m.role='owner' order by rr.id limit 1;
 select user_id into u from public.organization_members where organization_id=r.organization_id and role='owner' limit 1;
 i=jsonb_build_object('organization_id',r.organization_id,'establishment_id',r.establishment_id,'review_id',r.id,'analysis_text_sha256',repeat('a',64),'configuration_id',c.id,'instruction_version',c.config->>'instruction_version','instruction_sha256',c.instruction_sha256,'threshold_version',c.config->>'threshold_version','threshold_sha256',c.threshold_sha256,'requested_model','jev-latest','expected_served_model','jev-test-no-request');
 a=public.reserve_jev_economy_cache(u,i);b=public.reserve_jev_economy_cache(u,i);
 if a->>'claimed'<>'true' or b->>'claimed'<>'false' or a->>'id'<>b->>'id' or b->>'retry_allowed'<>'false' then raise exception 'RESERVATION_NOT_IDEMPOTENT';end if;
 blocked=false;begin perform public.reserve_jev_economy_cache('00000000-0000-0000-0000-000000000000',i);exception when others then if sqlerrm='FORBIDDEN' then blocked=true;else raise;end if;end;if not blocked then raise exception 'ROLE_FENCE_MISSING';end if;
 blocked=false;begin update public.analysis_jev_review_cache set status='dispatched',attempt_id=gen_random_uuid(),confirmed_by=u,confirmed_at=now() where id=(a->>'id')::uuid;exception when others then if sqlerrm='ECONOMY_PAID_ENGINE_DISABLED' then blocked=true;else raise;end if;end;if not blocked then raise exception 'PAID_ENGINE_ENABLED';end if;
 blocked=false;begin update public.analysis_jev_economy_configurations set config=config where id=c.id;exception when others then if sqlerrm='ECONOMY_IMMUTABLE' then blocked=true;else raise;end if;end;if not blocked then raise exception 'CONFIG_MUTABLE';end if;
 blocked=false;begin delete from public.analysis_jev_review_cache where id=(a->>'id')::uuid;exception when others then if sqlerrm='ECONOMY_CACHE_PERMANENT' then blocked=true;else raise;end if;end;if not blocked then raise exception 'CACHE_NOT_PERMANENT';end if;
 if exists(select 1 from public.analysis_jev_review_cache where status='completed') then
 blocked=false;begin update public.analysis_jev_review_cache set response=response where id=(select id from public.analysis_jev_review_cache where status='completed' limit 1);exception when others then if sqlerrm='ECONOMY_CACHE_IMMUTABLE' then blocked=true;else raise;end if;end;if not blocked then raise exception 'COMPLETED_CACHE_MUTABLE';end if;
 end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
end $$;
set local role authenticated;
do $$begin
 if (select count(*) from public.analysis_jev_economy_configurations)<>2 then raise exception 'OWNER_READ_FAILED';end if;
 if exists(select 1 from public.analysis_jev_review_cache c where not exists(select 1 from public.organization_members m where m.user_id=auth.uid() and m.organization_id=c.organization_id)) then raise exception 'CROSS_TENANT_LEAK';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
set local role authenticated;
do $$begin if exists(select 1 from public.analysis_jev_review_cache) or exists(select 1 from public.analysis_jev_economy_comparisons) or exists(select 1 from public.analysis_jev_economy_configurations) then raise exception 'UNAUTHORIZED_READ';end if;end $$;
reset role;
set local role anon;
do $$declare blocked boolean=false;begin begin perform count(*) from public.analysis_jev_review_cache;exception when insufficient_privilege then blocked=true;end;if not blocked then raise exception 'ANON_ACCESS';end if;end $$;
reset role;
select 'economy_sql_rls_idempotence_passed' as result;
rollback;
