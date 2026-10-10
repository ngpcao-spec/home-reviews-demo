-- Read-only invariants and rollback-only writes to the new preparation tables.
begin;
do $$declare s public.analysis_jev_compact_sets;u uuid;r uuid;z jsonb;blocked boolean=false;originals jsonb;before_texts integer;begin
 if exists(select 1 from public.analysis_jev_compact_runs) or exists(select 1 from public.analysis_jev_compact_tasks) or exists(select 1 from public.analysis_jev_compact_authorizations) then raise exception 'UNEXPECTED_PAID_WORK';end if;
 if (select count(*) from public.analysis_jev_compact_ai_references)<>0 then raise exception 'UNEXPECTED_FAKE_REFERENCES';end if;
 if has_function_privilege('authenticated','public.start_compact_run(uuid,uuid,boolean,text,jsonb,numeric)','execute') or has_table_privilege('anon','public.analysis_jev_compact_items','select') or has_table_privilege('authenticated','public.analysis_jev_compact_ai_references','insert') then raise exception 'PRIVILEGE_LEAK';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'analysis_jev_compact_%' and not c.relrowsecurity) then raise exception 'RLS_MISSING';end if;
 select * into s from public.analysis_jev_compact_sets limit 1;
 if found then
 u=s.created_by;if (select count(*) from public.analysis_jev_compact_items where set_id=s.id)<>32 or (select count(*) from public.analysis_jev_compact_items where set_id=s.id and selection_bucket='low')<>17 or (select count(*) from public.analysis_jev_compact_items where set_id=s.id and selection_bucket='four')<>11 or (select count(*) from public.analysis_jev_compact_items where set_id=s.id and selection_bucket='five')<>4 then raise exception 'STRATA_INVALID';end if;
 if exists(select 1 from public.analysis_jev_compact_items i where i.set_id=s.id and (i.original_text_sha256<>encode(extensions.digest(i.original_text,'sha256'),'hex') or not exists(select 1 from public.reviews r where r.id=i.review_id and r.organization_id=s.organization_id))) then raise exception 'TEXT_OR_TENANT_INVALID';end if;
 if public.prepare_compact_set(u,s.organization_id)<>s.id then raise exception 'DATASET_DUPLICATED';end if;
 begin perform public.prepare_compact_set('00000000-0000-0000-0000-000000000000',s.organization_id);exception when others then if sqlerrm='FORBIDDEN' then blocked=true;else raise;end if;end;if not blocked then raise exception 'TENANT_FENCE_MISSING';end if;
 blocked=false;begin perform public.seal_compact_set(u,s.id);exception when others then if sqlerrm in ('COMPACT_ENGLISH_REQUIRED','COMPACT_AI_REFERENCE_REQUIRED') then blocked=true;else raise;end if;end;if not blocked then raise exception 'EMPTY_REFERENCE_SEALED';end if;
 blocked=false;begin perform public.start_compact_run(u,s.id,true,'invalid','{"input":0.042,"output":0}',.02);exception when others then if sqlerrm='COMPACT_SEAL_REQUIRED' then blocked=true;else raise;end if;end;if not blocked then raise exception 'UNSEALED_PAID_START';end if;
 select jsonb_agg(jsonb_build_object('review_id',review_id,'original_text',original_text) order by review_id) into originals from public.analysis_jev_compact_items where set_id=s.id;
 select review_id into r from public.analysis_jev_compact_items where set_id=s.id limit 1;
 blocked=false;begin perform public.import_compact_texts(u,s.id,jsonb_build_array(jsonb_build_object('review_id',r,'original_text_sha256',repeat('b',64),'analysis_text','Synthetic rejected text','analysis_text_sha256',encode(extensions.digest('Synthetic rejected text','sha256'),'hex'),'language','en','source','manual_chatgpt_translation_en','model_source','synthetic')));exception when others then if sqlerrm='COMPACT_TRANSLATION_HASH_MISMATCH' then blocked=true;else raise;end if;end;if not blocked then raise exception 'INVALID_HASH_ACCEPTED';end if;
 select count(*) into before_texts from public.analysis_jev_compact_texts where set_id=s.id;
 select jsonb_build_array(jsonb_build_object('review_id',review_id,'original_text_sha256',original_text_sha256,'analysis_text','Synthetic English for rollback-only test','analysis_text_sha256',encode(extensions.digest('Synthetic English for rollback-only test','sha256'),'hex'),'language','en','source','manual_chatgpt_translation_en','model_source','sql-fixture-not-a-real-translation')) into z from public.analysis_jev_compact_items where set_id=s.id and text_id is null limit 1;
 if z is not null then perform public.import_compact_texts(u,s.id,z);perform public.import_compact_texts(u,s.id,z);if (select count(*) from public.analysis_jev_compact_texts where set_id=s.id)<>before_texts+1 then raise exception 'TRANSLATION_IMPORT_NOT_IDEMPOTENT';end if;end if;
 if originals is distinct from (select jsonb_agg(jsonb_build_object('review_id',review_id,'original_text',original_text) order by review_id) from public.analysis_jev_compact_items where set_id=s.id) then raise exception 'ORIGINAL_MUTATED';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 end if;end $$;
set local role authenticated;
do $$begin if exists(select 1 from public.analysis_jev_compact_items i where not exists(select 1 from public.organization_members m where m.user_id=auth.uid() and m.organization_id=i.organization_id and m.role in ('owner','admin','manager'))) then raise exception 'CROSS_TENANT_READ';end if;end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
set local role authenticated;
do $$begin if exists(select 1 from public.analysis_jev_compact_sets) or exists(select 1 from public.analysis_jev_compact_texts) then raise exception 'UNAUTHORIZED_READ';end if;end $$;
reset role;
select 'compact_sql_rls_preparation_passed' result;
rollback;
