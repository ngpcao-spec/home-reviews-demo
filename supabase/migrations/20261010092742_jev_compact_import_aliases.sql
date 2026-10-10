CREATE OR REPLACE FUNCTION public.import_compact_texts(p_user uuid, p_set uuid, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s public.analysis_jev_compact_sets;i public.analysis_jev_compact_items;x jsonb;tid uuid;n integer=0;begin
 select * into s from public.analysis_jev_compact_sets where id=p_set for update;if not found or not exists(select 1 from public.organization_members where organization_id=s.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if s.status<>'draft' or exists(select 1 from public.analysis_jev_compact_ai_references where set_id=s.id) then raise exception 'COMPACT_TEXTS_LOCKED';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 32 or (select count(distinct e.value->>'review_id') from jsonb_array_elements(p_rows) e)<>jsonb_array_length(p_rows) then raise exception 'COMPACT_TRANSLATION_INVALID';end if;
 for x in select value from jsonb_array_elements(p_rows) loop
 select * into i from public.analysis_jev_compact_items where set_id=p_set and review_id=(x->>'review_id')::uuid;if not found or x->>'original_text_sha256' is distinct from i.original_text_sha256 or x->>'language' is distinct from 'en' or coalesce(x->>'source','') not in ('manual_chatgpt_translation_en','manual_verified_translation_en') or btrim(coalesce(x->>'model_source',''))='' or btrim(coalesce(x->>'analysis_text',''))='' or x->>'analysis_text_sha256' is distinct from encode(extensions.digest(x->>'analysis_text','sha256'),'hex') then raise exception 'COMPACT_TRANSLATION_HASH_MISMATCH';end if;
 insert into public.analysis_jev_compact_texts(set_id,review_id,organization_id,original_text_sha256,analysis_text,analysis_text_sha256,language,source,model_source,provenance,created_by) values(p_set,i.review_id,s.organization_id,i.original_text_sha256,x->>'analysis_text',x->>'analysis_text_sha256','en',x->>'source',x->>'model_source',coalesce(x->'provenance','{}'::jsonb),p_user) on conflict(set_id,review_id,analysis_text_sha256) do nothing;
 select id into tid from public.analysis_jev_compact_texts where set_id=p_set and review_id=i.review_id and analysis_text_sha256=x->>'analysis_text_sha256';update public.analysis_jev_compact_items set text_id=tid where set_id=p_set and review_id=i.review_id;n=n+1;
 end loop;insert into public.analysis_jev_compact_events(set_id,organization_id,actor_id,action,details) values(p_set,s.organization_id,p_user,'english_texts_imported_no_api',jsonb_build_object('rows',n));return n;end $function$
;
CREATE OR REPLACE FUNCTION public.import_compact_references(p_user uuid, p_set uuid, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s public.analysis_jev_compact_sets;x jsonb;begin
 select * into s from public.analysis_jev_compact_sets where id=p_set for update;if not found or not exists(select 1 from public.organization_members where organization_id=s.organization_id and user_id=p_user and role in ('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 if s.status<>'draft' or exists(select 1 from public.analysis_jev_compact_runs where set_id=p_set) then raise exception 'COMPACT_REFERENCES_LOCKED';end if;
 if (select count(*) from public.analysis_jev_compact_items where set_id=p_set and text_id is not null)<>32 then raise exception 'COMPACT_ENGLISH_REQUIRED';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<>800 or (select count(distinct (e.value->>'review_id')||':'||(e.value->>'theme_key')) from jsonb_array_elements(p_rows) e)<>800 then raise exception 'COMPACT_AI_REFERENCE_REQUIRED';end if;
 if exists(select 1 from public.analysis_jev_compact_ai_references where set_id=p_set) then
 if exists(select 1 from jsonb_array_elements(p_rows) e left join public.analysis_jev_compact_ai_references r on r.set_id=p_set and r.review_id=(e.value->>'review_id')::uuid and r.theme_key=e.value->>'theme_key' where r.choice is distinct from e.value->>'choice' or r.analysis_text_sha256 is distinct from e.value->>'analysis_text_sha256' or r.model_source is distinct from e.value->>'model_source' or e.value->>'annotation_protocol' is distinct from r.annotation_protocol or e.value->>'reference_type' is distinct from r.reference_type) then raise exception 'COMPACT_REFERENCE_IMMUTABLE';end if;return 800;end if;
 for x in select value from jsonb_array_elements(p_rows) loop
 insert into public.analysis_jev_compact_ai_references(set_id,review_id,organization_id,theme_key,choice,analysis_text_sha256,model_source,annotation_protocol,reference_type,created_by) values(p_set,(x->>'review_id')::uuid,s.organization_id,x->>'theme_key',x->>'choice',x->>'analysis_text_sha256',x->>'model_source',x->>'annotation_protocol',x->>'reference_type',p_user);
 end loop;insert into public.analysis_jev_compact_events(set_id,organization_id,actor_id,action,details) values(p_set,s.organization_id,p_user,'blind_ai_references_imported',jsonb_build_object('labels',800,'human_gold',false));return 800;end $function$
;
