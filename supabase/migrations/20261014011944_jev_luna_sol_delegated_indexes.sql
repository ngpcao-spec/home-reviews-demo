-- Cover the organization-bound foreign keys without changing any historical rows.
create index jls_protocol_plan_scope on public.analysis_jev_luna_sol_protocols(plan_id,organization_id);
create index jls_dossier_run_scope on public.analysis_jev_luna_sol_dossiers(run_id,organization_id);
