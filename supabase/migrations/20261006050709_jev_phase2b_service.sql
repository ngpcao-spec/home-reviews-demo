-- Expand only the experimental type constraint; preserve every stored result.
alter table public.jev_benchmark_runs drop constraint jev_benchmark_runs_benchmark_type_check;
alter table public.jev_benchmark_runs add constraint jev_benchmark_runs_benchmark_type_check
  check (benchmark_type in ('axes_phase1','themes_phase2','themes_phase2b_service'));
