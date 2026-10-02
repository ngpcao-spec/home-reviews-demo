-- Run with a privileged test connection. Every fixture/change is rolled back.
begin;
do $test$
declare
  e public.establishments; member_id uuid; r public.historical_report_runs; again public.historical_report_runs;
  second_id uuid; third_id uuid; worker_a uuid:=gen_random_uuid(); worker_b uuid:=gen_random_uuid();
  claimed integer; valid boolean; old_report jsonb; new_report jsonb; old_hash text;
begin
  if exists(select 1 from public.historical_report_runs where status in ('queued','running','retry')) then
    raise exception 'TEST_REQUIRES_NO_ACTIVE_RUNS'; end if;
  select * into strict e from public.establishments where id='bfc486b8-4cc7-4cd5-ab59-1a118c61aced';
  select user_id into strict member_id from public.organization_members where organization_id=e.organization_id and role='owner' limit 1;
  select to_jsonb(h) into strict old_report from public.historical_establishment_reports h where establishment_id=e.id and preferred_language='vi';
  old_hash:=md5(old_report::text);

  select * into r from public.enqueue_historical_report(e.id,e.organization_id,member_id,'vi');
  select * into again from public.enqueue_historical_report(e.id,e.organization_id,member_id,'vi');
  assert r.generation_id=again.generation_id,'double click created another run';
  assert r.status='queued','not enqueued';
  assert old_hash=(select md5(to_jsonb(h)::text) from public.historical_establishment_reports h where establishment_id=e.id and preferred_language='vi'),'old report modified';
  begin
    insert into public.historical_report_runs(organization_id,establishment_id,language,status,snapshot) values(e.organization_id,e.id,'vi','queued','{}');
    raise exception 'PARTIAL_UNIQUE_FAILED';
  exception when unique_violation then null;
  end;
  -- Two other establishments allow exercising the GLOBAL concurrency cap.
  select id into strict second_id from public.establishments where organization_id=e.organization_id and id<>e.id order by id limit 1;
  select id into strict third_id from public.establishments where organization_id=e.organization_id and id not in(e.id,second_id) order by id limit 1;
  perform public.enqueue_historical_report(second_id,e.organization_id,member_id,'vi');
  perform public.enqueue_historical_report(third_id,e.organization_id,member_id,'vi');
  select count(*) into claimed from public.claim_historical_report_jobs(worker_a,99);
  assert claimed=2,'global cap must be two';
  select count(*) into claimed from public.claim_historical_report_jobs(worker_b,99);
  assert claimed=0,'second worker exceeded global leases';

  -- Isolate the fixture run; original generations are NEVER changed.
  update public.historical_report_runs set status='failed',locked_by=null,lease_until=null
    where status in ('queued','running','retry') and id<>r.id;
  update public.historical_report_runs set status='running',locked_by=worker_a,lease_until=now()+interval '4 minutes',
    cursor=3,findings=(select jsonb_agg(jsonb_build_object('test',n)) from generate_series(1,168)n)
    where id=r.id;
  valid:=public.checkpoint_historical_report_run(r.id,r.generation_id,worker_b,3,'{"cursor":4}');
  assert not valid,'foreign lease accepted';
  valid:=public.checkpoint_historical_report_run(r.id,r.generation_id,worker_a,2,'{"cursor":3}');
  assert not valid,'stale cursor accepted';
  update public.historical_report_runs set lease_until=now()-interval '1 second' where id=r.id;
  valid:=public.checkpoint_historical_report_run(r.id,r.generation_id,worker_a,3,'{"cursor":4}');
  assert not valid,'expired lease accepted';
  select * into again from public.claim_historical_report_jobs(worker_b,1);
  assert again.generation_id=r.generation_id and again.cursor=3 and jsonb_array_length(again.findings)=168,'checkpoint lost on recovery';
  assert again.locked_by=worker_b and again.lease_recovery_count=1,'expired lease not recovered';
  valid:=public.checkpoint_historical_report_run(r.id,r.generation_id,worker_b,3,
    '{"status":"retry","next_retry_at":"2099-01-01","locked_by":null,"lease_until":null}');
  assert valid,'retry checkpoint failed';
  select count(*) into claimed from public.claim_historical_report_jobs(worker_a,2);
  assert claimed=0,'backoff ignored';
  update public.historical_report_runs set next_retry_at=now()-interval '1 second' where id=r.id;
  select * into again from public.claim_historical_report_jobs(worker_a,1);
  assert again.cursor=3,'retry replayed cursor';

  new_report:=(old_report-'id')||jsonb_build_object('generation_id',r.generation_id,'updated_at',now());
  valid:=public.complete_historical_report_run(r.id,r.generation_id,worker_b,3,new_report);
  assert not valid,'foreign worker published';
  valid:=public.complete_historical_report_run(r.id,r.generation_id,worker_a,3,new_report);
  assert valid,'atomic publication failed';
  assert (select status='completed' and locked_by is null from public.historical_report_runs where id=r.id),'run not completed';
  assert (select generation_id=r.generation_id from public.historical_establishment_reports where establishment_id=e.id and preferred_language='vi'),'report not published';
  select * into again from public.enqueue_historical_report(e.id,e.organization_id,member_id,'vi');
  assert again.generation_id<>r.generation_id,'regeneration did not create new generation';
  update public.historical_report_runs set attempt_count=5 where id=again.id;
  perform public.claim_historical_report_jobs(worker_a,1);
  assert (select status='failed' from public.historical_report_runs where id=again.id),'unbounded failures';
  assert not has_function_privilege('authenticated','public.claim_historical_report_jobs(uuid,integer)','EXECUTE'),'client can claim';
  assert not has_function_privilege('anon','public.enqueue_historical_report(uuid,uuid,uuid,text)','EXECUTE'),'anon can enqueue';
end $test$;
rollback;
select 'PASS: enqueue dedupe, partial unique, global concurrency, lease fencing/recovery, checkpoint retention, retry backoff, atomic publish, regeneration, max attempts, RPC permissions; all fixtures rolled back' as result;

