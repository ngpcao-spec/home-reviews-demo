-- Transaction-only assertions: no job is ever committed or visible to the cron.
begin;
do $test$
declare e record; a public.historical_report_runs; b public.historical_report_runs; c public.historical_report_runs;
begin
  select p.establishment_id,p.organization_id,p.preferred_language,m.user_id into e
  from public.historical_establishment_reports p
  join public.organization_members m on m.organization_id=p.organization_id and m.role in ('owner','admin','manager')
  where not exists(select 1 from public.historical_report_runs r where r.establishment_id=p.establishment_id
    and r.language=p.preferred_language and r.status in ('queued','running','retry','failed'))
  limit 1;
  if not found then raise exception 'TEST_REQUIRES_IDLE_ESTABLISHMENT'; end if;
  a:=public.enqueue_historical_report(e.establishment_id,e.organization_id,e.user_id,e.preferred_language,'gpt-5.6-terra');
  b:=public.enqueue_historical_report(e.establishment_id,e.organization_id,e.user_id,e.preferred_language,'gpt-6.1-sol');
  if a.generation_id<>b.generation_id or b.model<>'gpt-5.6-terra' then raise exception 'TEST_ACTIVE_MODEL_CHANGED'; end if;
  begin
    update public.historical_report_runs set model='gpt-6.1-sol' where id=a.id;
    raise exception 'TEST_IMMUTABILITY_FAILED';
  exception when others then
    if sqlerrm<>'REPORT_MODEL_IMMUTABLE' then raise; end if;
  end;
  update public.historical_report_runs set status='completed' where id=a.id;
  c:=public.enqueue_historical_report(e.establishment_id,e.organization_id,e.user_id,e.preferred_language,'gpt-6.1-sol');
  if c.generation_id=a.generation_id or c.model<>'gpt-6.1-sol' then raise exception 'TEST_NEW_SOL_FAILED'; end if;
  -- now() is transaction-stable; distinguish the simulated later generation.
  update public.historical_report_runs set status='failed',created_at=created_at+interval '1 second' where id=c.id;
  b:=public.enqueue_historical_report(e.establishment_id,e.organization_id,e.user_id,e.preferred_language,'gpt-5.6-terra');
  if b.generation_id<>c.generation_id or b.model<>'gpt-6.1-sol' then raise exception 'TEST_RETRY_MODEL_CHANGED'; end if;
  begin
    update public.historical_establishment_reports set generation_id=c.generation_id,ai_model='gpt-5.6-terra'
      where establishment_id=e.establishment_id and preferred_language=e.preferred_language;
    raise exception 'TEST_PUBLICATION_GUARD_FAILED';
  exception when others then
    if sqlerrm<>'REPORT_MODEL_MISMATCH' then raise; end if;
  end;
  if has_function_privilege('authenticated','public.enqueue_historical_report(uuid,uuid,uuid,text,text)','EXECUTE')
    or has_function_privilege('anon','public.enqueue_historical_report(uuid,uuid,uuid,text,text)','EXECUTE')
    then raise exception 'TEST_RPC_PUBLICLY_EXECUTABLE'; end if;
end $test$;
rollback;
select 'model pinning, active dedupe, new generation, retry, publication guard, RPC grants: passed; all writes rolled back' as result;
