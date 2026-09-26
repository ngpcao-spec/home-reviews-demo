begin;
select plan(5);

insert into auth.users(id,email) values
  ('10000000-0000-4000-8000-000000000001','owner-a@example.test'),
  ('20000000-0000-4000-8000-000000000002','owner-b@example.test');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from public.organizations),1,'tenant A sees exactly one organization');
select is((select count(*)::integer from public.organization_members),1,'tenant A sees exactly one membership');
select lives_ok($$insert into public.establishments(organization_id,name,address,google_maps_url,google_place_ref,source_provider,provider_place_ref) select id,'A','Paris','https://www.google.com/maps/place/A','a','mock','a' from public.organizations limit 1$$,'tenant A can create its establishment');

select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select is((select count(*)::integer from public.establishments),0,'tenant B cannot see tenant A establishments');
select throws_ok($$update public.establishments set name='stolen'$$,'42501','new row violates row-level security policy for table "establishments"','tenant B cannot mutate tenant A establishments');

select * from finish();
rollback;
