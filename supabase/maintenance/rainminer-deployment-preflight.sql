-- Read-only. Save these results before deployment and compare immutable fields
-- afterwards; never print Vault decrypted_secret or provider credentials.
begin read only;
select version from supabase_migrations.schema_migrations
 where version in ('20261124030622','20261124035425') order by version;
select status,count(*) jobs from public.rainminer_menu_jobs group by status order by status;
select id,place_id,status,run_id,lease_until from public.rainminer_menu_jobs
 where status in ('starting','running','unknown') order by created_at;
select count(*) jobs,md5(coalesce(string_agg(md5(jsonb_build_object(
 'id',id,'establishment_id',establishment_id,'place_id',place_id,'request_id',request_id,
 'run_id',run_id,'raw',raw,'result',result,'created_at',created_at)::text),'' order by id),'')) immutable_fingerprint
 from public.rainminer_menu_jobs;
select count(*) versions,md5(coalesce(string_agg(md5(to_jsonb(v)::text),'' order by restaurant_id,run_id),'')) fingerprint
 from private.shared_restaurant_menu_versions v;
select jobid,jobname,active,schedule from cron.job where jobname='home-reviews-rainminer-menu';
select name,count(*)=1 present_once from vault.decrypted_secrets
 where name in ('home_reviews_rainminer_worker_url','home_reviews_scheduler_token') group by name;
select has_table_privilege('authenticated','public.rainminer_menu_jobs','select') as client_can_read_jobs,
 has_function_privilege('authenticated','public.claim_rainminer_menu()','execute') as client_can_claim;
commit;
