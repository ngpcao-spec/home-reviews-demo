-- Cover compound foreign keys in NEW V2 execution tables only.
create index luna_nv2_plan_set_org on public.analysis_luna_negative_v2_plans(set_id,organization_id);
create index luna_nv2_run_plan_org on public.analysis_luna_negative_v2_runs(plan_id,organization_id);
create index luna_nv2_task_run_org on public.analysis_luna_negative_v2_tasks(run_id,organization_id);
create index luna_nv2_event_run_org on public.analysis_luna_negative_v2_events(run_id,organization_id);
create index luna_nv2_result_run_org on public.analysis_luna_negative_v2_results(run_id,organization_id);
