CREATE OR REPLACE FUNCTION public.save_hybrid_balanced_preparation(p_user uuid, p_base uuid, p_body jsonb, p_sha text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare b public.analysis_jev_hybrid_plans;s public.analysis_jev_pilot_snapshots;pid uuid;e jsonb;r jsonb; packet_e jsonb;c public.analysis_jev_review_cache;n int;dist jsonb;begin
 select * into b from public.analysis_jev_hybrid_plans where id=p_base and version='jev-hybrid-evidence-report-v1';
 if b.id is null or not exists(select 1 from public.organization_members where organization_id=b.organization_id and user_id=p_user and role in('owner','admin','manager')) then raise exception 'FORBIDDEN';end if;
 select * into s from public.analysis_jev_pilot_snapshots where id=b.source_snapshot_id;
 if p_body->>'version' is distinct from 'jev-hybrid-evidence-report-v1.1-balanced'
 or p_body->>'source_snapshot_id' is distinct from s.id::text or p_body->>'source_sha256' is distinct from s.source_sha256
 or p_body->>'language' is distinct from b.language or p_body->>'organization_id' is distinct from b.organization_id::text or p_body->>'establishment_id' is distinct from b.establishment_id::text
 or p_body->>'jev_configuration' is distinct from 'v12_economy_1pass_v1' or p_body->>'selector_rule_version' is distinct from 'theme-bound-excerpt-quality-v1.1'
 or p_body->>'paid_enabled' is distinct from 'false' or p_body->>'production_enabled' is distinct from 'false' or p_body->>'simulation' is distinct from 'true'
 or p_body->'sol_response' is distinct from 'null'::jsonb or p_body->>'new_paid_calls' is distinct from '0'
 or p_body->'estimates'->>'jev_new_requests' is distinct from '0' or p_body->'estimates'->>'input_budget_tokens' is distinct from '20000'
 or (p_body->'estimates'->>'estimated_input_tokens')::int>20000
 or p_body->'packet'->>'pipeline' is distinct from p_body->>'version'
 or p_body->'comparison'->>'v1_sha256' is distinct from b.result_sha256
 or p_body->'analytics' is distinct from b.body->'analytics' or p_body->'statistics_sha256' is distinct from b.body->'statistics_sha256'
 or p_body->'cache_fingerprints' is distinct from b.body->'cache_fingerprints'
 or p_body->'v3_rule_sha256' is distinct from b.body->'v3_rule_sha256'
 or coalesce(p_body->>'selector_sha256','') !~ '^[a-f0-9]{64}$'
 or coalesce(p_body->>'selector_source_sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'BALANCED_SCOPE_CHANGED';end if;
 if p_sha is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body),'sha256'),'hex')
 or p_body->>'dossier_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body->'packet'),'sha256'),'hex')
 or p_body->>'prompt_sha256' is distinct from encode(extensions.digest(p_body->>'prompt','sha256'),'hex')
 or p_body->>'schema_sha256' is distinct from encode(extensions.digest(public.jev_economy_canonical(p_body->'schema'),'sha256'),'hex')
 or p_body->'packet'->'statistics' is distinct from p_body->'analytics'
 or p_body->'request_preview'->'input'->0->>'content' is distinct from p_body->>'prompt'
 or (p_body->'request_preview'->'input'->1->>'content')::jsonb is distinct from p_body->'packet'
 or p_body->'request_preview'->'text'->'format'->'schema' is distinct from p_body->'schema' then raise exception 'BALANCED_HASH_CHANGED';end if;
 n:=jsonb_array_length(p_body->'selected');
 if n>32 or n<>jsonb_array_length(p_body->'packet'->'evidence') or (p_body->'selected_summary'->>'total')::int<>n
 or (select count(distinct e->>'evidence_id') from jsonb_array_elements(p_body->'selected') e)<>n
 or exists(select 1 from jsonb_array_elements(p_body->'selected') e group by e->>'review_id' having count(*)>2)
 or exists(select 1 from jsonb_array_elements(p_body->'cache_fingerprints') f where not exists(select 1 from public.analysis_jev_review_cache c where c.id=(f->>'cache_id')::uuid and c.organization_id=s.organization_id and c.establishment_id=s.establishment_id and c.status='completed' and c.configuration_id='v12_economy_1pass_v1' and c.review_id=(f->>'review_id')::uuid and c.analysis_text_sha256=f->>'text_sha256' and encode(extensions.digest(public.jev_economy_canonical(jsonb_build_object('cache_key',c.cache_key,'response',c.response,'theme_results',c.theme_results,'served_model',c.served_model)),'sha256'),'hex')=f->>'response_sha256')) then raise exception 'BALANCED_CACHE_OR_SELECTION_CHANGED';end if;
 for e in select value from jsonb_array_elements(p_body->'selected') loop
  select value into r from jsonb_array_elements(s.source->'reviews') where value->>'id'=e->>'review_id';
  select value into packet_e from jsonb_array_elements(p_body->'packet'->'evidence') where value->>'evidence_id'=e->>'evidence_id';
  select cc.* into c from public.analysis_jev_review_cache cc join jsonb_array_elements(p_body->'cache_fingerprints') f on cc.id=(f->>'cache_id')::uuid where cc.review_id=(e->>'review_id')::uuid;
  if r is null or c.id is null or packet_e is null or e->>'status'='explicitly_contested' or e->'quality'->>'eligible' is distinct from 'true'
  or e->>'analysis_text_sha256' is distinct from r->>'analysis_text_sha256'
  or e->>'quote' is distinct from public.hybrid_utf16_slice(r->>'analysis_text',(e->>'quote_start')::int,(e->>'quote_end')::int)
  or e->>'context' is distinct from public.hybrid_utf16_slice(r->>'analysis_text',(e->>'context_start')::int,(e->>'context_end')::int)
  or strpos(e->>'context',e->>'quote')=0
  or e->>'quote_sha256' is distinct from encode(extensions.digest(e->>'quote','sha256'),'hex')
  or e->>'rating' is distinct from r->>'rating'
  or e->'jev_result' is distinct from c.theme_results->(e->>'theme_key')
  or not(case when e->>'polarity'='negative' then c.theme_results->(e->>'theme_key')->>'choice' in('negative','both') when e->>'polarity'='positive' then c.theme_results->(e->>'theme_key')->>'choice' in('positive','both') else false end)
  or exists(select 1 from jsonb_array_elements(b.body->'contested') x where x->>'review_id'=e->>'review_id' and x->>'theme_key'=e->>'theme_key' and x->>'polarity'=e->>'polarity')
  or (e->>'quote' ~* '\mbot\s+expensive\M' and e->>'status'='rule_confirmed')
  or packet_e->>'quote' is distinct from e->>'quote' or packet_e->>'quote_sha256' is distinct from e->>'quote_sha256' or packet_e->>'review_id' is distinct from e->>'review_id'
  or packet_e->>'theme_key' is distinct from e->>'theme_key' or packet_e->>'polarity' is distinct from e->>'polarity' then raise exception 'BALANCED_QUOTE_CHANGED';end if;
 end loop;
 select jsonb_object_agg(star::text,(select count(*) from jsonb_array_elements(p_body->'selected') e where (e->>'rating')::int=star)) into dist from generate_series(1,5) star;
 if dist is distinct from p_body->'selected_summary'->'star_distribution' then raise exception 'BALANCED_STAR_SUMMARY_CHANGED';end if;
 if exists(select 1 from jsonb_array_elements(p_body->'selected_review_texts') t where not exists(select 1 from jsonb_array_elements(s.source->'reviews') r where r->>'id'=t->>'review_id' and r->>'analysis_text'=t->>'analysis_text' and r->>'analysis_text_sha256'=t->>'analysis_text_sha256')) then raise exception 'BALANCED_FULL_TEXT_CHANGED';end if;
 perform pg_advisory_xact_lock(hashtextextended(s.id::text||':'||b.language||':'||p_sha,0));
 select id into pid from public.analysis_jev_hybrid_plans where source_snapshot_id=s.id and language=b.language and result_sha256=p_sha;
 if found then return pid;end if;
 insert into public.analysis_jev_hybrid_plans(organization_id,establishment_id,source_snapshot_id,version,language,source_sha256,dossier_sha256,prompt_sha256,schema_sha256,statistics_sha256,result_sha256,body,created_by)
 values(s.organization_id,s.establishment_id,s.id,p_body->>'version',b.language,s.source_sha256,p_body->>'dossier_sha256',p_body->>'prompt_sha256',p_body->>'schema_sha256',p_body->>'statistics_sha256',p_sha,p_body,p_user) returning id into pid;
 insert into public.analysis_jev_hybrid_events(organization_id,plan_id,actor_user_id,action,payload) values(s.organization_id,pid,p_user,'free_balanced_preparation_frozen',jsonb_build_object('paid_calls',0,'source_v1_plan',p_base));return pid;
end $function$
