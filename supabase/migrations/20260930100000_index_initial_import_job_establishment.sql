create index if not exists initial_import_jobs_establishment_idx
  on public.initial_import_jobs (establishment_id)
  where establishment_id is not null;
