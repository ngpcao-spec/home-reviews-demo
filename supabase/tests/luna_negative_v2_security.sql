-- Read-only assertions / rolled-back mutations of the NEW preparation only.
begin;
do $$declare t text;begin
 foreach t in array array['analysis_luna_negative_v2_sets','analysis_luna_negative_v2_reviews','analysis_luna_negative_v2_associations','analysis_luna_negative_v2_reference_seals','analysis_luna_negative_v2_references'] loop
 if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=t and c.relrowsecurity) then raise exception 'RLS_MISSING';end if;
 if has_table_privilege('authenticated','public.'||t,'INSERT') or has_table_privilege('authenticated','public.'||t,'UPDATE') or has_table_privilege('authenticated','public.'||t,'DELETE') or has_table_privilege('anon','public.'||t,'SELECT') then raise exception 'PUBLIC_WRITE_OR_ANON_READ';end if;
 if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname='luna_negative_immutable' and not tgisinternal) then raise exception 'IMMUTABILITY_MISSING';end if;
 end loop;
 if has_function_privilege('authenticated','public.save_luna_negative_v2_set(uuid,jsonb,text)','EXECUTE') or has_function_privilege('anon','public.luna_negative_v2_inventory(uuid)','EXECUTE') then raise exception 'RPC_EXPOSED';end if;
 if exists(select 1 from public.analysis_luna_negative_v2_reference_seals) or exists(select 1 from public.analysis_luna_negative_v2_references) then raise exception 'UNEXPECTED_REFERENCE';end if;
 if exists(select 1 from public.analysis_luna_negative_v2_sets where paid_enabled or production_enabled) then raise exception 'PAID_OR_PROD_ENABLED';end if;
end $$;
set local role service_role;
do $$declare s public.analysis_luna_negative_v2_sets;other uuid;begin
 select * into s from public.analysis_luna_negative_v2_sets where version='luna-negative-focused-v2';
 if s.id is null then raise exception 'PREPARATION_NOT_SEALED';end if;
 other:=public.save_luna_negative_v2_set(s.created_by,s.body,s.body_sha256);if other<>s.id then raise exception 'IDEMPOTENCE_FAILED';end if;
 begin update public.analysis_luna_negative_v2_sets set body=body||'{"altered":true}'::jsonb where id=s.id;raise exception 'MUTATION_ACCEPTED';exception when others then if sqlerrm='MUTATION_ACCEPTED' then raise;end if;end;
 begin perform public.save_luna_negative_v2_set('00000000-0000-4000-8000-000000000001',s.body,s.body_sha256);raise exception 'CROSS_TENANT_RPC_ACCEPTED';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
 if (select count(*) from public.analysis_luna_negative_v2_reviews where set_id=s.id)<>s.review_count or (select count(*) from public.analysis_luna_negative_v2_associations where set_id=s.id)<>s.question_count then raise exception 'COUNTS_CHANGED';end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$begin if exists(select 1 from public.analysis_luna_negative_v2_sets) or exists(select 1 from public.analysis_luna_negative_v2_reviews) or exists(select 1 from public.analysis_luna_negative_v2_associations) then raise exception 'CROSS_TENANT_READ';end if;end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','d6e79d9c-72cd-40d2-a945-0452b268a783',true);
do $$begin if (select count(*) from public.analysis_luna_negative_v2_sets)<>1 then raise exception 'OWNER_READ_FAILED';end if;end $$;
rollback;
select 'NEGATIVE_V2_SQL_RLS_IDEMPOTENCE_IMMUTABILITY_PASSED' status;
