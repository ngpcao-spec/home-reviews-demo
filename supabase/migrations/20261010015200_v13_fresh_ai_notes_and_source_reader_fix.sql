-- HOME Reviews: make freshly sealed GPT-6 AI reference notes reproducible and fix
-- the PL/pgSQL variable-shadowing bug in the fresh V13 source reader.
-- Safe on projects where the notes table or corrected function already exists.
-- No paid JEV, Sol or Apify calls. No benchmark or production switch.

CREATE TABLE IF NOT EXISTS public.analysis_jev_v13_fresh_ai_reference_notes (
 source_id uuid NOT NULL REFERENCES public.analysis_jev_v13_sealed_inputs(id),
 review_id uuid NOT NULL REFERENCES public.reviews(id),
 analysis_text_sha256 text NOT NULL,
 overall_text_sentiment text NOT NULL,
 notes_fr text NOT NULL,
 uncertain_notes_fr text NOT NULL DEFAULT '',
 translation_caution boolean NOT NULL DEFAULT false,
 outside_taxonomy_notes_fr text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_id,review_id)
);
ALTER TABLE public.analysis_jev_v13_fresh_ai_reference_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analysis_jev_v13_fresh_ai_reference_notes FROM public,anon,authenticated;
GRANT SELECT, INSERT ON public.analysis_jev_v13_fresh_ai_reference_notes TO service_role;
COMMENT ON TABLE public.analysis_jev_v13_fresh_ai_reference_notes IS
 'Blind ChatGPT AI notes, not human Gold. These notes do not change the sealed reference or trigger a JEV run.';

-- The variable 'i' declared by the PL/pgSQL function must not be reused as
-- the jsonb_array_elements() SQL alias when checking whether ref.review_id
-- belongs to the sealed items. The alias input_review avoids ambiguity.
CREATE OR REPLACE FUNCTION public.read_jev_v13_source(p_kind text, p_source uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r jsonb;cfg jsonb;tasks jsonb;paired jsonb;audits jsonb;input public.analysis_jev_v13_sealed_inputs;i jsonb;ref jsonb;org uuid;source_date timestamptz;lang jsonb;
begin select config into cfg from public.analysis_jev_v13_configurations where id='themes_v13_targeted_recall_v1';
 if p_kind='development_first' then
 if p_source<>'1b06d0d9-623b-4ee4-b267-d1078a2aaa74'::uuid then raise exception 'V13_SOURCE_REQUIRED';end if;
 select to_jsonb(s) into r from public.analysis_jev_v12_runs s where id=p_source and status='completed';if r is null or r->'config' is distinct from cfg->'v12' then raise exception 'V13_BASELINE_CHANGED';end if;
 select dataset_snapshot into lang from public.analysis_negative_ai_exploratory_runs where id=(r->>'source_benchmark_id')::uuid;
 for i in select * from jsonb_array_elements(r->'prepared'->'items') loop if not exists(select 1 from jsonb_array_elements(lang) x where x->>'review_id'=i->>'review_id' and x->>'analysis_language'='en' and x->>'analysis_text_sha256'=i->>'analysis_text_sha256') then raise exception 'V13_ENGLISH_CHANGED';end if;end loop;
 select jsonb_agg(to_jsonb(t)||'{"model_version":"v12"}'::jsonb order by t.id) into tasks from public.analysis_jev_v12_tasks t where run_id=p_source;
 return jsonb_build_object('run',r,'tasks',tasks,'input_rate',r->'prepared'->'input_rate','output_rate',0);
 elsif p_kind='development_second' then
 if p_source<>'696e6e36-a024-4f69-957e-9cd4e0b50d1b'::uuid then raise exception 'V13_SOURCE_REQUIRED';end if;
 select to_jsonb(s) into r from public.analysis_jev_independent_runs s where id=p_source and status='completed';if r is null or r->'config'->'v12' is distinct from cfg->'v12' then raise exception 'V13_BASELINE_CHANGED';end if;
 perform public.validate_independent_jev_source((r->>'holdout_id')::uuid);
 select jsonb_agg(x->'review_id' order by (x->>'position')::int) into paired from public.analysis_jev_independent_results t cross join lateral jsonb_array_elements(t.comparison->'reviews') x where t.run_id=p_source and jsonb_typeof(x->'v11')='object' and jsonb_typeof(x->'v12')='object';
 select jsonb_agg(to_jsonb(t) order by t.id) into tasks from public.analysis_jev_independent_tasks t where run_id=p_source and model_version='v12';
 select coalesce(jsonb_agg(to_jsonb(a) order by audit_id),'[]'::jsonb) into audits from public.analysis_jev_independent_ai_error_audits a where run_id=p_source;
 return jsonb_build_object('run',r,'tasks',tasks,'paired_ids',paired,'audits',audits,'input_rate',r->'prepared'->'rates'->'input','output_rate',r->'prepared'->'rates'->'output');
 elsif p_kind='fresh_blind_ai' then
 select * into input from public.analysis_jev_v13_sealed_inputs where id=p_source and configuration_id='themes_v13_targeted_recall_v1';if not found then raise exception 'V13_FRESH_SEAL_REQUIRED';end if;
 select frozen_at into source_date from public.analysis_jev_v13_configurations where id=input.configuration_id;
 if input.sealed_at>now() or source_date>input.reference_created_at or input.reference_created_at>input.sealed_at or not input.blind_to_predictions or encode(extensions.digest(input.items::text,'sha256'),'hex')<>input.dataset_sha256 or encode(extensions.digest(input.reference::text,'sha256'),'hex')<>input.reference_sha256 then raise exception 'V13_FRESH_SEAL_CHANGED';end if;
 for i in select * from jsonb_array_elements(input.items) loop
 if i->>'analysis_language'<>'en' or btrim(i->>'analysis_text')='' or encode(extensions.digest(convert_to(i->>'analysis_text','UTF8'),'sha256'),'hex')<>i->>'analysis_text_sha256' or not exists(select 1 from public.reviews v join public.establishments e on e.id=v.establishment_id where v.id=(i->>'review_id')::uuid and e.id=(i->>'establishment_id')::uuid and e.id<>'252a8dca-14c7-4f09-bd1f-7b2c40ae97aa'::uuid and e.organization_id=input.organization_id and v.organization_id=input.organization_id and btrim(v.original_text)<>'' and ((lower(v.original_language) in ('en','english','en-us','en-gb') and v.original_text=i->>'analysis_text') or exists(select 1 from public.review_translations t where t.review_id=v.id and lower(t.language) in ('en','english','en-us','en-gb') and t.translated_text=i->>'analysis_text'))) then raise exception 'V13_ENGLISH_TEXT_CHANGED';end if;
 if exists(select 1 from public.jev_v13_used_review_ids(input.organization_id,p_source) u where u=(i->>'review_id')::uuid) then raise exception 'V13_FRESH_DATASET_ALREADY_USED';end if;
 end loop;
 if (select count(distinct x->>'review_id') from jsonb_array_elements(input.items) x)<>jsonb_array_length(input.items) or (select count(distinct (x->>'review_id')||':'||(x->>'theme_key')) from jsonb_array_elements(input.reference) x)<>jsonb_array_length(input.reference) then raise exception 'V13_REFERENCE_CHANGED';end if;
 for ref in select * from jsonb_array_elements(input.reference) loop
 if not exists(select 1 from jsonb_array_elements(input.items) as input_review(value) where input_review.value->>'review_id'=ref->>'review_id') or not(cfg->'v13'->'thresholds' ? (ref->>'theme_key')) or ref->>'choice' not in ('absent','positive','negative','both','uncertain') or coalesce(ref->>'origin','')='' or coalesce(ref->>'model_source','')='' then raise exception 'V13_REFERENCE_CHANGED';end if;
 end loop;
 return jsonb_build_object('input',to_jsonb(input),'used_ids','[]'::jsonb,'input_rate',(select prepared->'rates'->'input' from public.analysis_jev_independent_runs where id='696e6e36-a024-4f69-957e-9cd4e0b50d1b'::uuid),'output_rate',0);
 else raise exception 'V13_SOURCE_REQUIRED';end if;
end $function$

