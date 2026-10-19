-- Preserve both existing scopes; add only the pinned direct-four preparation.
alter table public.analysis_jls_restaurant_protocols
 drop constraint analysis_jls_restaurant_protocols_establishment_id_check;
alter table public.analysis_jls_restaurant_protocols
 add constraint analysis_jls_restaurant_protocols_establishment_id_check check(
 establishment_id='d40d3438-79d8-4c28-8b09-eba640598201'::uuid or
 (establishment_id='a9a6ec1c-cbb3-4e39-a498-86f2e68bd4b8'::uuid and
 (body->>'version'='jls-historical-snapshot-v2-vi-v1' or
 (body->>'version'='jls-direct4-execution-v1' and
 body->>'preparation_id'='bace8577-e302-42fe-8625-ff9951c1c788' and
 body->>'preparation_sha256'='4752a9a1e214633052a1138faa3b6ef45e487a8cbc040048c6ceaea3c6e0a813'))));
