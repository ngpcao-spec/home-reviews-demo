-- Transactional integration test: no committed fixtures, provider/AI calls or real push.
begin;
do $$
declare
  v_user uuid; v_org uuid; v_place uuid; v_job uuid; v_notice uuid; v_claim record;
  v_language text; v_count integer;
begin
  select m.user_id,m.organization_id into v_user,v_org
  from public.organization_members m join public.profiles p on p.user_id=m.user_id limit 1;
  if v_user is null then raise exception 'TEST_REQUIRES_ONE_MEMBER'; end if;
  foreach v_language in array array['fr','vi'] loop
    update public.profiles set preferred_language=v_language where user_id=v_user;
    insert into public.establishments(organization_id,name,google_id,google_maps_url,address,active)
    values(v_org,'Import test canonical name','test-'||gen_random_uuid(),
      'https://www.google.com/maps/place/test','test',false) returning id into v_place;
    insert into public.initial_import_jobs(organization_id,user_id,query,expected_google_id,
      establishment_id,reviews_target,reviews_inserted)
    values(v_org,v_user,'https://www.google.com/maps/place/test','test-'||gen_random_uuid(),v_place,100,65)
    returning id into v_job;
    if exists(select 1 from public.notifications where import_job_id=v_job) then
      raise exception 'QUEUED_IMPORT_NOTIFIED'; end if;
    update public.initial_import_jobs set status='failed' where id=v_job;
    if exists(select 1 from public.notifications where import_job_id=v_job) then
      raise exception 'FAILED_IMPORT_NOTIFIED'; end if;
    update public.initial_import_jobs set status='completed' where id=v_job;
    select id into strict v_notice from public.notifications where import_job_id=v_job;
    if not exists(select 1 from public.notifications where id=v_notice and review_id is null
      and user_id=v_user and establishment_id=v_place and body like '%65%'
      and title=case when v_language='vi' then 'Nhập dữ liệu hoàn tất' else 'Import terminé' end)
    then raise exception 'WRONG_LOCALIZED_NOTIFICATION'; end if;
    update public.initial_import_jobs set status='completed' where id=v_job;
    update public.initial_import_jobs set status='running' where id=v_job;
    update public.initial_import_jobs set status='completed' where id=v_job;
    select count(*) into v_count from public.notifications where import_job_id=v_job;
    if v_count<>1 then raise exception 'DUPLICATE_NOTIFICATION'; end if;
    select * into strict v_claim from public.claim_import_completion_pushes() where notification_id=v_notice;
    if exists(select 1 from public.claim_import_completion_pushes() where notification_id=v_notice) then
      raise exception 'DOUBLE_PUSH_CLAIM'; end if;
    if public.finish_import_completion_push(v_notice,gen_random_uuid(),'sent') then
      raise exception 'INVALID_LEASE_ACCEPTED'; end if;
    perform public.finish_import_completion_push(v_notice,v_claim.lease_token,'failed');
    update private.import_completion_pushes set available_at=now()-interval '1 second' where notification_id=v_notice;
    select * into strict v_claim from public.claim_import_completion_pushes() where notification_id=v_notice;
    perform public.finish_import_completion_push(v_notice,v_claim.lease_token,'sent');
    if exists(select 1 from public.claim_import_completion_pushes() where notification_id=v_notice) then
      raise exception 'COMPLETED_PUSH_RECLAIMED'; end if;
  end loop;
  if has_function_privilege('authenticated','public.claim_import_completion_pushes()','execute')
    or has_function_privilege('anon','public.claim_import_completion_pushes()','execute')
    or has_column_privilege('authenticated','public.notifications','push_status','update')
    or not has_column_privilege('authenticated','public.notifications','read_at','update') then
    raise exception 'UNSAFE_NOTIFICATION_PRIVILEGES'; end if;
end $$;
rollback;
