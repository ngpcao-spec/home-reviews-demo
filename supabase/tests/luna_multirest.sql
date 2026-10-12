-- Rollback-only mocks. Harness starts BEGIN and sets home_reviews.multi_manifest.
set local role service_role;
do $$declare m jsonb:=current_setting('home_reviews.multi_manifest')::jsonb;u uuid;sid uuid;sha text;rid uuid;refs jsonb;refsha text;bad boolean;source jsonb;
begin
 if current_user<>'service_role' or has_table_privilege('service_role','auth.users','select') then raise exception 'MULTI_WRONG_RUNTIME_ROLE';end if;
 source:=public.luna_multirest_source_check();if jsonb_array_length(source->'identities')<>40 or jsonb_array_length(source->'establishments')<>11 or source->'historical_ids'<>'[]'::jsonb or source->'cache_ids'<>'[]'::jsonb then raise exception 'MULTI_SOURCE_AUDIT_FAILED';end if;
 u:=(source->'control'->>'created_by')::uuid;sha:=encode(extensions.digest(public.jev_economy_canonical(m),'sha256'),'hex');
 sid:=public.save_luna_multirest_set(u,m,sha);if public.save_luna_multirest_set(u,m,sha)<>sid then raise exception 'MULTI_IDEMPOTENCE_FAILED';end if;
 if (select count(*) from public.analysis_luna_multirest_cases where set_id=sid)<>40 then raise exception 'MULTI_COUNT_FAILED';end if;
 if has_table_privilege('authenticated','public.analysis_luna_multirest_sets','insert') or has_function_privilege('authenticated','public.save_luna_multirest_set(uuid,jsonb,text)','execute') or has_table_privilege('anon','public.analysis_luna_multirest_cases','select') then raise exception 'MULTI_UNSAFE_GRANTS';end if;
 bad:=false;begin perform public.save_luna_multirest_set('ffffffff-ffff-4fff-8fff-ffffffffffff',m,sha);exception when others then if sqlerrm='FORBIDDEN' then bad:=true;else raise;end if;end;if not bad then raise exception 'MULTI_CROSS_TENANT_ALLOWED';end if;
 bad:=false;begin update public.analysis_luna_multirest_sets set body_sha256=repeat('0',64) where id=sid;exception when others then bad:=true;end;if not bad then raise exception 'MULTI_DATASET_MUTABLE';end if;
 if exists(select 1 from public.analysis_luna_multirest_results where set_id=sid) then raise exception 'MULTI_RESULTS_FABRICATED';end if;
 select jsonb_build_object('protocol','luna-multirest-evidence-v1','dataset_sha256',sha,'annotation_model','GPT-6','reference_type','GPT6_AI_reference_not_independent_human_Gold','items',jsonb_agg(jsonb_build_object('review_id',review_id,'theme_key',theme_key,'analysis_text_sha256',analysis_text_sha256,'choice',case when position=1 then 'uncertain' else 'absent' end,'justification','MOCK_SQL_ONLY_NOT_ANNOTATION') order by position)) into refs from public.analysis_luna_multirest_cases where set_id=sid;
 refsha:=encode(extensions.digest(public.jev_economy_canonical(refs),'sha256'),'hex');rid:=public.seal_luna_multirest_references(u,sid,refs,refsha);
 if public.seal_luna_multirest_references(u,sid,refs,refsha)<>rid or (select count(*) from public.analysis_luna_multirest_references where set_id=sid)<>40 then raise exception 'MULTI_REF_IDEMPOTENCE_FAILED';end if;
 if (select count(*) from public.analysis_luna_multirest_references where set_id=sid and choice='uncertain')<>1 then raise exception 'MULTI_UNCERTAIN_NOT_PRESERVED';end if;
 bad:=false;begin update public.analysis_luna_multirest_references set choice='positive' where set_id=sid;exception when others then bad:=true;end;if not bad then raise exception 'MULTI_REFS_MUTABLE';end if;
 bad:=false;begin perform public.seal_luna_multirest_references(u,sid,jsonb_set(refs,'{dataset_sha256}',to_jsonb(repeat('0',64))),refsha);exception when others then if sqlerrm='MULTIREST_REFERENCE_INVALID' then bad:=true;else raise;end if;end;if not bad then raise exception 'MULTI_WRONG_REF_ACCEPTED';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','d6e79d9c-72cd-40d2-a945-0452b268a783',true);
do $$begin if (select count(*) from public.analysis_luna_multirest_sets)<>1 or (select count(*) from public.analysis_luna_multirest_cases)<>40 then raise exception 'MULTI_OWNER_READ_FAILED';end if;end $$;
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
do $$begin if exists(select 1 from public.analysis_luna_multirest_sets) or exists(select 1 from public.analysis_luna_multirest_cases) or exists(select 1 from public.analysis_luna_multirest_references) or exists(select 1 from public.analysis_luna_multirest_reference_seals) then raise exception 'MULTI_RLS_LEAK';end if;end $$;
reset role;
