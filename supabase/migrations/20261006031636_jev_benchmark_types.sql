-- Only the experimental table changes. Existing rows become axes_phase1.
alter table public.jev_benchmark_runs add column benchmark_type text not null default 'axes_phase1'
  check (benchmark_type in ('axes_phase1','themes_phase2'));
drop index public.jev_benchmark_runs_one_active_source;
create unique index jev_benchmark_runs_one_active_source
  on public.jev_benchmark_runs (organization_id,source_generation_id,benchmark_type) where status='running';
create index jev_benchmark_runs_source_type_created_idx
  on public.jev_benchmark_runs (source_generation_id,benchmark_type,created_at desc);
