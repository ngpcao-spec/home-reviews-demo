begin;
select plan(6);

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'owner-a@example.test'),
  ('20000000-0000-4000-8000-000000000002', 'owner-b@example.test');

insert into public.establishments (
  organization_id,
  name,
  google_id,
  google_maps_url,
  address
)
select
  organization.id,
  'Tenant A',
  '0xaaa:0x111',
  'https://www.google.com/maps/place/Tenant-A',
  'Paris'
from public.organizations as organization
where organization.created_by = '10000000-0000-4000-8000-000000000001';

insert into public.reviews (
  organization_id,
  establishment_id,
  external_review_id,
  rating,
  requires_attention,
  requires_ai_analysis,
  status
)
select
  establishment.organization_id,
  establishment.id,
  'review-a',
  1,
  true,
  false,
  'to_process'
from public.establishments as establishment
where establishment.google_id = '0xaaa:0x111';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.organizations), 1, 'tenant A sees one organization');
select is((select count(*)::integer from public.organization_members), 1, 'tenant A sees one membership');
select is((select count(*)::integer from public.establishments), 1, 'tenant A sees its establishment');
select is((select count(*)::integer from public.reviews), 1, 'tenant A sees its review');

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.establishments), 0, 'tenant B cannot see tenant A establishment');
select throws_ok(
  $$update public.establishments set name = 'stolen'$$,
  '42501',
  'permission denied for table establishments',
  'tenant B cannot mutate tenant A establishment'
);

select * from finish();
rollback();

