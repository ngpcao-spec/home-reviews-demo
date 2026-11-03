-- Derived, disposable cache only. No business sheet/publication, attempt or grant
-- is updated, backfilled, rearmed or consumed by this migration.
create table public.recommendation_light_sheet_cache (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 establishment_id uuid not null references public.establishments(id) on delete cascade,
 language text not null check(language in ('fr','vi')),
 format_version text not null check(format_version='recommendation-light-v1'),
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 sheet jsonb not null check(jsonb_typeof(sheet)='object' and sheet ? 'id' and sheet->>'id'=establishment_id::text),
 primary key(organization_id,language,establishment_id,format_version)
);
create index recommendation_light_sheet_establishment_idx on public.recommendation_light_sheet_cache(establishment_id);
alter table public.recommendation_light_sheet_cache enable row level security;
revoke all on public.recommendation_light_sheet_cache from public,anon,authenticated;
grant select on public.recommendation_light_sheet_cache to authenticated;
grant select,insert,update,delete on public.recommendation_light_sheet_cache to service_role;
create policy recommendation_light_sheet_manager_read on public.recommendation_light_sheet_cache
 for select to authenticated using (
 exists(select 1 from public.organization_members m where m.organization_id=recommendation_light_sheet_cache.organization_id
  and m.user_id=(select auth.uid()) and m.role in ('owner','admin','manager'))
 and exists(select 1 from public.establishments e where e.id=recommendation_light_sheet_cache.establishment_id
  and e.organization_id=recommendation_light_sheet_cache.organization_id)
);
comment on table public.recommendation_light_sheet_cache is
 'Server-produced deterministic light sheets. Source SHA-256 includes source content, tenant, establishment, language and format. Not a paid-result cache or trial authorization.';
