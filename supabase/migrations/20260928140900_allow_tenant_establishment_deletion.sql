grant delete on table public.establishments to authenticated;

create policy establishments_delete
on public.establishments
for delete
to authenticated
using (
  (select private.has_org_role(
    establishments.organization_id,
    array['owner'::text, 'admin'::text]
  ))
);
