-- Set test.parallel_archive_protocol to an existing parallel protocol. No
-- consent, run, task, provider attempt or historical result is changed.
begin;
set local role service_role;
do $$declare pid uuid=current_setting('test.parallel_archive_protocol')::uuid;a uuid;v jsonb='{"explicit_technical_mock":true,"provider_calls":0}'::jsonb;failed boolean=false;n int=0;begin
 a=public.save_jls_snapshot_preparation(pid,'EXPLICIT_ARCHIVE_ROLLBACK_TEST',v,public.jls_restaurant_hash(v));
 assert a=public.save_jls_snapshot_preparation(pid,'EXPLICIT_ARCHIVE_ROLLBACK_TEST',v,public.jls_restaurant_hash(v));n=n+1;
 begin perform public.save_jls_snapshot_preparation(pid,'EXPLICIT_ARCHIVE_ROLLBACK_TEST',v||'{"changed":true}',public.jls_restaurant_hash(v||'{"changed":true}'));exception when raise_exception then failed=true;end;
 assert failed,'immutable archive overwritten';n=n+1;failed=false;
 begin perform public.save_jls_snapshot_preparation(pid,'EXPLICIT_BAD_HASH',v,repeat('0',64));exception when raise_exception then failed=true;end;
 assert failed,'wrong hash accepted';n=n+1;failed=false;
 begin perform public.save_jls_snapshot_preparation(pid,'compact_reused_source_forbidden',v,public.jls_restaurant_hash(v));exception when raise_exception then failed=true;end;
 assert failed,'source certificate guard weakened';n=n+1;
 assert not has_function_privilege('authenticated','public.save_jls_snapshot_preparation(uuid,text,jsonb,text)','execute');n=n+1;
 assert (select organization_id from public.analysis_jls_snapshot_preparations where id=a)=(select organization_id from public.analysis_jls_restaurant_protocols where id=pid);n=n+1;
 perform set_config('test.parallel_archive_result',jsonb_build_object('assertions',n,'provider_calls',0,'rollback',true)::text,true);
end $$;
select current_setting('test.parallel_archive_result')::jsonb as archive_checks;
rollback;
