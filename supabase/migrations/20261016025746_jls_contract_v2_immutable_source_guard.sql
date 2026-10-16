-- Immutable parent bodies were hashed at compilation/sealing. The actual source
-- artifact is still fully hashed by verifyContractV2 at every worker wake.
-- Live 78-cache and 28-native-response checks below remain unchanged.
create or replace function public.check_jls_contract_v2_sources(p_protocol uuid) returns boolean language plpgsql stable security invoker set search_path='' as $fn$
declare p public.analysis_jls_contract_v2_protocols;a public.analysis_jls_sol_ready_artifacts;r public.analysis_jls_recommendation_reviews;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into p from public.analysis_jls_contract_v2_protocols where id=p_protocol;
 select * into a from public.analysis_jls_sol_ready_artifacts where id=p.source_artifact_id;
 select * into r from public.analysis_jls_recommendation_reviews where id=p.source_archive_id;
 return p.id is not null and a.organization_id=p.organization_id and r.organization_id=p.organization_id
 and a.sha256=p.body->>'source_artifact_sha256' and r.sha256=p.body->>'source_archive_sha256'
 and r.body->>'original_result_sha256'=p.body->>'source_result_sha256'
 and public.check_jls_sol_ready_sources(a.body)
 and exists(select 1 from public.organization_members m where m.organization_id=p.organization_id and m.user_id=p.authority_user_id and m.role in('owner','admin','manager'));
end $fn$;
