create or replace function public.check_jls_direct4_historical_sources(b jsonb) returns boolean
language plpgsql stable set search_path='' set jit='off' as $$
declare h public.historical_report_runs;x jsonb;r jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into h from public.historical_report_runs where id=(b->'historical'->>'id')::uuid;
 if not coalesce(b->>'version'='jls-direct4-historical-v1' and h.id='fa55c8a5-f6e3-43df-a792-e9beed974457'::uuid
 and h.establishment_id='6a53577a-c816-4548-845e-870995fbaed9'::uuid and h.status='completed' and h.language='vi'
 and b->>'organization_id'=h.organization_id::text and b->>'establishment_id'=h.establishment_id::text
 and b->>'authority_user_id'=h.requested_by::text and b->>'language'='vi'
 and b->'historical'->>'record_sha256'='0d34685f8bba042afa53f7aab095516f21e17da27ea8390dacca7bbaf0eba46c'
 and public.jls_restaurant_hash(to_jsonb(h))=b->'historical'->>'record_sha256'
 and b->'frozen_historical'=to_jsonb(h)
 and b->'historical'->>'source_fingerprint'=h.snapshot->'base'->>'source_fingerprint'
 and b->'historical'->>'snapshot_sha256'=public.jls_restaurant_hash(h.snapshot)
 and b->'historical'->>'published_report_sha256'=public.jls_restaurant_hash(b->'frozen_published_report')
 and b->'frozen_published_report'->>'generation_id'=h.generation_id::text
 and b->>'source_snapshot_sha256'=public.jls_restaurant_hash(b->'source_snapshot')
 and b->'source_snapshot'->>'source_reviews_sha256'=public.jls_restaurant_hash(b->'source_snapshot'->'reviews')
 and jsonb_array_length(b->'source_snapshot'->'reviews')=100
 and b->'denominators'='{"source_reviews":100,"analytical_reviews":68,"textless_statistics_only":32}'::jsonb
 and b->>'max_jev_calls'='68' and b->>'max_luna_calls'='32' and b->>'max_sol_calls'='1' and b->>'max_apify_calls'='0'
 and b->>'automatic_retry'='false' and b->>'production_enabled'='false' and b->'spending_authorization'='null'::jsonb
 and b->'run_id'='null'::jsonb and b->>'preparation_is_not_spending_authorization'='true'
 and b->>'classification_configuration_sha256'='e5995c6e4b3a8f5949cbcde2531180ad3af503e50ee38b1b7674fceed561fe69'
 and b->>'classification_configuration_sha256'=public.jls_restaurant_hash(b->'configuration'->'jev')
 and b->'configuration'->'jev_request_template'->'questions'=b->'configuration'->'jev'->'questions'
 and b->>'configuration_sha256'=public.jls_restaurant_hash(b->'configuration')
 and b->>'pending_sha256'=public.jls_restaurant_hash(b->'pending') and jsonb_array_length(b->'pending')=68
 and (select count(distinct value->>'review_id') from jsonb_array_elements(b->'pending'))=68
 and b->'cache'='[]'::jsonb and b->>'cache_sha256'=public.jls_restaurant_hash('[]'::jsonb)
 and b->'sol_size_policy'->>'input_budget_tokens'='32768' and b->'sol_size_policy'->>'max_output_tokens'='9500'
 and exists(select 1 from public.establishments e where e.id=h.establishment_id and e.organization_id=h.organization_id and e.active)
 and exists(select 1 from public.organization_members m where m.organization_id=h.organization_id and m.user_id=h.requested_by and m.role in('owner','admin','manager')),false) then return false;end if;
 for x in select value from jsonb_array_elements(b->'source_snapshot'->'reviews') loop
 select value into r from jsonb_array_elements(h.snapshot->'reviews') where value->>'id'=x->>'id';
 if r is null or x->>'original_text' is distinct from coalesce(r->>'original_text','')
 or x->>'analysis_text' is distinct from nullif(r->>'analysis_text','') or x->'rating' is distinct from r->'rating'
 or x->>'organization_id'<>h.organization_id::text or x->>'establishment_id'<>h.establishment_id::text
 or x->>'original_text_sha256'<>encode(extensions.digest(x->>'original_text','sha256'),'hex')
 or x->>'analysis_text' is not null and x->>'analysis_text_sha256'<>encode(extensions.digest(x->>'analysis_text','sha256'),'hex')
 then return false;end if;end loop;
 for x in select value from jsonb_array_elements(b->'pending') loop
 select value into r from jsonb_array_elements(b->'source_snapshot'->'reviews') where value->>'id'=x->>'review_id';
 if r is null or r->>'analysis_text' is null or x->'payload'->'state'->>'analysis_text' is distinct from r->>'analysis_text'
 or x->'payload'->>'model'<>'jev-latest'
 or x->>'request_sha256'<>public.jls_restaurant_hash((x->'payload')||jsonb_build_object('questions',b->'configuration'->'jev'->'questions'))
 or x->'identity'->>'configuration_sha256'<>b->>'classification_configuration_sha256'
 or x->'identity'->>'analysis_text_sha256'<>r->>'analysis_text_sha256' then return false;end if;end loop;return true;
end $$;