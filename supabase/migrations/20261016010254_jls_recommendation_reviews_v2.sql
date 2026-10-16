-- Free review only. No consent/run/task/worker/authorization is created.
create table public.analysis_jls_recommendation_reviews(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 run_id uuid not null references public.analysis_jls_restaurant_runs(id),
 operation_id uuid not null references public.analysis_jls_sol_ready_operations(id),
 version text not null check(version='jls-recommendation-review-v2'),body jsonb not null,sha256 text not null unique,
 created_at timestamptz not null default now(),unique(run_id,version));
create index on public.analysis_jls_recommendation_reviews(organization_id);
create index on public.analysis_jls_recommendation_reviews(operation_id);
alter table public.analysis_jls_recommendation_reviews enable row level security;
revoke all on public.analysis_jls_recommendation_reviews from public,anon,authenticated;
grant select on public.analysis_jls_recommendation_reviews to authenticated;
grant all on public.analysis_jls_recommendation_reviews to service_role;
create policy recommendation_review_org_read on public.analysis_jls_recommendation_reviews for select to authenticated using(
 exists(select 1 from public.organization_members m where m.organization_id=analysis_jls_recommendation_reviews.organization_id
 and m.user_id=(select auth.uid()) and m.role in('owner','admin','manager')));
create trigger recommendation_review_immutable before update or delete on public.analysis_jls_recommendation_reviews
 for each row execute function public.pilot_evidence_immutable();

-- Only technical structure may differ in an explicitly labelled derivative.
-- Keep every prose field, quote, context, theme, polarity, evidence ID and rank.
create function public.jls_recommendation_text_content(v jsonb) returns jsonb
 language sql immutable security invoker set search_path='' as $fn$
 select jsonb_set(v-'format_version','{report,recommendations}',coalesce((
 select jsonb_agg((a.value-array['priority','proposed_action'])||jsonb_build_object(
 'priority',(a.value->'priority')-array['frequency_keys','comparison_context'],
 'proposed_action',(a.value->'proposed_action')-'focus') order by a.ordinality)
 from jsonb_array_elements(v->'report'->'recommendations') with ordinality a),'[]'::jsonb));
 $fn$;
create function public.save_jls_recommendation_review(p_run uuid,p_value jsonb) returns uuid
 language plpgsql security invoker set search_path='' as $fn$
 declare r public.analysis_jls_restaurant_runs;o public.analysis_jls_sol_ready_operations;p public.analysis_jls_restaurant_protocols;
 a public.analysis_jls_sol_ready_artifacts;b jsonb;original jsonb;candidate jsonb;source_review jsonb;prior jsonb;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run;
 select * into o from public.analysis_jls_sol_ready_operations where run_id=r.id and mode='paid';
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 select * into a from public.analysis_jls_sol_ready_artifacts where id=o.artifact_id;
 b=p_value->'body';
 if r.id is null or o.id is null or o.status not in('completed','needs_review') or r.status not in('completed','needs_review')
 or o.request_count<>1 or o.result is null or o.receipt is null or o.organization_id<>r.organization_id or p.organization_id<>r.organization_id or a.organization_id<>r.organization_id
 or not exists(select 1 from public.organization_members m where m.organization_id=r.organization_id and m.user_id=p.authority_user_id and m.role in('owner','admin','manager'))
 or o.result_sha256<>public.jls_restaurant_hash(o.result) or a.sha256<>public.jls_restaurant_hash(a.body)
 or b->>'version' is distinct from 'jls-recommendation-review-v2' or p_value->>'sha256' is distinct from public.jls_restaurant_hash(b)
 or b->>'run_id' is distinct from r.id::text or b->>'operation_id' is distinct from o.id::text
 or b->>'source_protocol_id' is distinct from p.id::text or b->>'source_protocol_sha256' is distinct from p.sha256
 or b->>'original_result_sha256' is distinct from o.result_sha256
 or b->>'source_response_sha256' is distinct from o.result->>'response_sha256'
 or b->>'source_raw_response_sha256' is distinct from o.result->>'raw_response_sha256'
 or b->>'source_report_sha256' is distinct from o.result->'validated_report'->>'raw_response_sha256'
 or b->>'source_plan_sha256' is distinct from a.body->>'plan_sha256'
 or b->>'snapshot_sha256' is distinct from public.jls_restaurant_hash(p.body->'snapshot')
 or b->>'decisions_sha256' is distinct from a.body->>'decisions_sha256'
 or b->>'new_paid_calls' is distinct from '0' or b->>'production_enabled' is distinct from 'false'
 or b->>'human_validated' is distinct from 'false' or b->>'semantic_truth_guaranteed' is distinct from 'false'
 or b->'spending_authorization' is distinct from 'null'::jsonb or b->'new_paid_run' is distinct from 'null'::jsonb
 or coalesce(b->'provenance'->>'commit','') !~ '^[a-f0-9]{40}$'
 or (select count(*) from jsonb_each_text(b->'provenance'->'files'))<4
 or exists(select 1 from jsonb_each_text(b->'provenance'->'files') where value !~ '^[a-f0-9]{64}$')
 or b->'original_revalidation'->'validation' is distinct from o.result->'validated_report'
 or b->'original_revalidation'->>'content_unchanged' is distinct from 'true'
 or b->'original_revalidation'->>'validation_sha256' is distinct from public.jls_restaurant_hash(b->'original_revalidation'->'validation')
 or b->'derivative'->>'kind' is distinct from 'codex_offline_structural_revision_not_sol_output'
 or b->'derivative'->'raw'->>'format_version' is distinct from 'jls-prioritized-recommendations-v2'
 or b->'derivative'->'validation'->>'validator_version' is distinct from 'jls-observation-action-statistics-validation-v2'
 or b->'derivative'->>'text_and_sources_unchanged' is distinct from 'true'
 or b->'derivative'->>'source_report_sha256' is distinct from b->>'source_report_sha256'
 or b->'derivative'->>'raw_sha256' is distinct from public.jls_restaurant_hash(b->'derivative'->'raw')
 or b->'derivative'->>'validation_sha256' is distinct from public.jls_restaurant_hash(b->'derivative'->'validation')
 or b->'derivative'->'validation'->>'raw_response_sha256' is distinct from b->'derivative'->>'raw_sha256'
 or b->'derivative'->'validation'->>'statistics_sha256' is distinct from o.result->'validated_report'->>'statistics_sha256'
 or b->'future_preparation'->>'request_sha256' is distinct from public.jls_restaurant_hash(b->'future_preparation'->'request')
 or b->'future_preparation'->>'prompt_sha256' is distinct from encode(extensions.digest(b->'future_preparation'->>'prompt','sha256'),'hex')
 or b->'future_preparation'->>'schema_sha256' is distinct from public.jls_restaurant_hash(b->'future_preparation'->'schema')
 or b->'future_preparation'->>'dossier_sha256' is distinct from public.jls_restaurant_hash(b->'future_preparation'->'packet')
 or b->'future_preparation'->'request'->>'model' is distinct from 'gpt-6.1-sol'
 or b->'future_preparation'->>'version' is distinct from 'jls-recommendation-contract-v2'
 or b->'future_preparation'->>'new_paid_calls' is distinct from '0'
 then raise exception 'JLS_RECOMMENDATION_REVIEW_CHANGED';end if;
 select (c.value->>'text')::jsonb into original from jsonb_array_elements(o.result->'response'->'output') m(value)
 cross join lateral jsonb_array_elements(m.value->'content') c(value) where c.value->>'type'='output_text';
 if public.jls_recommendation_text_content(original) is distinct from public.jls_recommendation_text_content(b->'derivative'->'raw')
 then raise exception 'JLS_DERIVATIVE_TEXT_CHANGED';end if;
 for candidate in select value from jsonb_array_elements(b->'order_candidates') loop
 select value into source_review from jsonb_array_elements(p.body->'snapshot'->'source'->'reviews') where value->>'id'=candidate->>'review_id';
 if source_review is null or candidate->>'analysis_text_sha256' is distinct from source_review->>'analysis_text_sha256'
 or candidate->>'quote_sha256' is distinct from encode(extensions.digest(candidate->>'quote','sha256'),'hex')
 or candidate->>'context_sha256' is distinct from encode(extensions.digest(candidate->>'context','sha256'),'hex')
 or position(candidate->>'quote' in source_review->>'analysis_text')<1
 or position(candidate->>'context' in source_review->>'analysis_text')<1
 or candidate->>'status' is distinct from 'requires_luna' or candidate->'luna_verdict' is distinct from 'null'::jsonb
 or candidate->>'selector_version' is distinct from 'jls-autonomous-order-evidence-v2'
 then raise exception 'JLS_NEW_QUOTE_HAS_NO_LUNA_VERDICT';end if;end loop;
 perform pg_advisory_xact_lock(hashtextextended(r.id::text||':recommendation-review-v2',0));
 select id,body into rid,prior from public.analysis_jls_recommendation_reviews where run_id=r.id and version=b->>'version';
 if found then if prior is distinct from b then raise exception 'JLS_RECOMMENDATION_REVIEW_IMMUTABLE';end if;return rid;end if;
 insert into public.analysis_jls_recommendation_reviews(organization_id,run_id,operation_id,version,body,sha256)
 values(r.organization_id,r.id,o.id,b->>'version',b,p_value->>'sha256') returning id into rid;return rid;end $fn$;
revoke all on function public.jls_recommendation_text_content(jsonb),public.save_jls_recommendation_review(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.jls_recommendation_text_content(jsonb),public.save_jls_recommendation_review(uuid,jsonb) to service_role;

