-- Disambiguate the frozen review lookup; no data mutation.
create or replace function public.save_jls_snapshot_v2_protocol(p_body jsonb,p_sha text) returns uuid language plpgsql security invoker set search_path='' set jit='off' as $fn$
declare rid uuid;v jsonb;s jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_body->>'version' is distinct from 'jls-historical-snapshot-v2-vi-v1' or p_sha is distinct from public.jls_restaurant_hash(p_body)
 or p_body->>'establishment_id' is distinct from 'a9a6ec1c-cbb3-4e39-a498-86f2e68bd4b8'
 or not public.check_jls_snapshot_v2_source(p_body)
 or p_body->>'preparation_is_not_spending_authorization' is distinct from 'true'
 or p_body->'configuration'->'policy'->>'automatic_retry' is distinct from 'false'
 or p_body->'configuration'->'policy'->>'provider_client_retries' is distinct from '0'
 or p_body->'configuration'->'policy'->>'format_version' is distinct from 'jls-prioritized-recommendations-v2'
 or p_body->'configuration'->'policy'->>'language' is distinct from 'vi'
 or p_body->>'max_sol_calls' is distinct from '1' or p_body->>'max_luna_calls' is distinct from '32'
 or jsonb_array_length(p_body->'snapshot'->'source'->'reviews')<>100 or jsonb_array_length(p_body->'english_review_ids')<>80
 or (select count(distinct value->>'id') from jsonb_array_elements(p_body->'snapshot'->'source'->'reviews'))<>100
 or jsonb_array_length(p_body->'pending')+jsonb_array_length(p_body->'cache')<>80
 or (select count(distinct id) from(select value->>'review_id' id from jsonb_array_elements(p_body->'pending') union all select value->>'review_id' from jsonb_array_elements(p_body->'cache'))x)<>80
 or (select count(*) from jsonb_object_keys(p_body->'configuration'->'jev_request_template'->'questions'))<>25
 or p_body->'configuration'->'policy'->>'jev_configuration' is distinct from 'v12_economy_1pass_v1'
 or (p_body->>'max_jev_calls')::int<>jsonb_array_length(p_body->'pending')
 or p_body->>'configuration_sha256' is distinct from public.jls_restaurant_hash(p_body->'configuration')
 or p_body->>'cache_sha256' is distinct from public.jls_restaurant_hash(p_body->'cache')
 or p_body->>'pending_sha256' is distinct from public.jls_restaurant_hash(p_body->'pending')
 or not exists(select 1 from public.organization_members m where m.organization_id=(p_body->>'organization_id')::uuid
 and m.user_id=(p_body->>'authority_user_id')::uuid and m.role in('owner','admin','manager'))
 then raise exception 'JLS_SNAPSHOT_PROTOCOL_INVALID';end if;
 for v in select value from jsonb_array_elements(p_body->'snapshot'->'source'->'reviews') loop
 select value into s from jsonb_array_elements(p_body->'frozen_v2'->'historical_snapshot'->'reviews') where value->>'id'=v->>'id';
 if s is null or v->>'original_text' is distinct from coalesce(s->>'original_text','')
 or v->>'analysis_text' is distinct from nullif(s->>'analysis_text','')
 or v->'review_context' is distinct from s->'review_context' or v->'review_detailed_rating' is distinct from s->'review_detailed_rating'
 or v->'rating' is distinct from s->'rating' or v->>'original_text_sha256' is distinct from encode(extensions.digest(v->>'original_text','sha256'),'hex')
 or v->>'analysis_text' is not null and (v->>'analysis_language'<>'en' or v->>'analysis_text_sha256' is distinct from encode(extensions.digest(v->>'analysis_text','sha256'),'hex'))
 then raise exception 'JLS_FROZEN_REVIEW_CHANGED';end if;end loop;
 for v in select value from jsonb_array_elements(p_body->'pending') loop
 if not(p_body->'english_review_ids' ? (v->>'review_id')) or not exists(select 1 from jsonb_array_elements(p_body->'snapshot'->'source'->'reviews') frozen_entry
 where frozen_entry->>'id'=v->>'review_id' and frozen_entry->>'analysis_text'=v->'payload'->'state'->>'analysis_text' and frozen_entry->>'analysis_text_sha256'=v->'identity'->>'analysis_text_sha256') or v->>'request_sha256' is distinct from
 public.jls_restaurant_hash((v->'payload')||jsonb_build_object('questions',p_body->'configuration'->'jev_request_template'->'questions'))
 or v->'payload'->>'model' is distinct from 'jev-latest' or (select array_agg(key order by key) from jsonb_object_keys(v->'payload'->'state')key) is distinct from array['analysis_text','review_alias']::text[]
 then raise exception 'JLS_JEV_REQUEST_CHANGED';end if;end loop;
 insert into public.analysis_jls_restaurant_protocols(organization_id,establishment_id,authority_user_id,body,sha256)
 values((p_body->>'organization_id')::uuid,(p_body->>'establishment_id')::uuid,(p_body->>'authority_user_id')::uuid,p_body,p_sha)
 on conflict(sha256) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_restaurant_protocols where sha256=p_sha;end if;return rid;
end $fn$;
