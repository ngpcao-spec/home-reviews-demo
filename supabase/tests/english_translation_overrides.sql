-- Read-only checks; never enqueue a report or mutate a review/translation/snapshot.
begin;
do $$
declare org uuid;ids uuid[];expected integer;definition text;
begin
 for org,ids,expected in select r.organization_id,array_agg(o.review_id),count(*)::integer from public.analysis_review_english_translation_overrides o join public.reviews r on r.id=o.review_id group by r.organization_id loop
  if (select count(*) from public.read_analysis_english_translation_overrides(org,ids,now()))<>expected then raise exception 'Scoped overrides missing';end if;
  if (select count(*) from public.read_analysis_english_translation_overrides('00000000-0000-4000-8000-000000000001',ids,now()))<>0 then raise exception 'Cross tenant override leak';end if;
  if (select count(*) from public.read_analysis_english_translation_overrides(org,array['00000000-0000-4000-8000-000000000026']::uuid[],now()))<>0 then raise exception 'Other review matched';end if;
  if (select count(*) from public.read_analysis_english_translation_overrides(org,ids,'2026-10-08T00:00:00Z'))<>0 then raise exception 'Old run sees a future correction';end if;
 end loop;
 select pg_get_functiondef('public.enqueue_historical_report(uuid,uuid,uuid,text,text,integer)'::regprocedure) into definition;
 if position('verified_english_translation_overrides_v1' in definition)=0 or position('p_analysis_version>=7' in definition)=0 then raise exception 'New English policy not wired';end if;
 if exists(select 1 from public.analysis_review_english_translation_overrides o join public.reviews r on r.id=o.review_id join public.review_translations t on t.review_id=r.id and t.language='en' where o.original_text_sha256<>encode(extensions.digest(r.original_text,'sha256'),'hex') or o.provider_translation_sha256<>encode(extensions.digest(t.translated_text,'sha256'),'hex') or o.corrected_english_sha256<>encode(extensions.digest(o.corrected_english_text,'sha256'),'hex') or o.correction_language<>'en') then raise exception 'Current correction hashes invalid';end if;
end $$;
set local role authenticated;
do $$ begin
 begin perform count(*) from public.analysis_review_english_translation_overrides;raise exception 'Raw corrections exposed';exception when insufficient_privilege then null;end;
 begin perform public.read_analysis_english_translation_overrides(gen_random_uuid(),array[]::uuid[],now());raise exception 'Client can call server-only reader';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role anon;
do $$ begin begin perform public.read_analysis_english_translation_overrides(gen_random_uuid(),array[]::uuid[],now());raise exception 'Anonymous reader exposed';exception when insufficient_privilege then null;end;end $$;
reset role;
rollback;
