-- Tighten execution privileges on the pre-existing RLS helper and cover
-- the remaining foreign keys used by the HOME Reviews synchronization model.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create index if not exists organizations_created_by_idx
  on public.organizations (created_by);

create index if not exists sync_runs_organization_id_idx
  on public.sync_runs (organization_id);
