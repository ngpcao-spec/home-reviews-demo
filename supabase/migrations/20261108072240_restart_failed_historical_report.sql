-- A fresh manual intent after a terminal batch failure abandons that source
-- atomically. Its replacement must analyse the whole freshly frozen corpus.
do $$
declare
  d text := pg_get_functiondef('public.enqueue_current_report(uuid,uuid,uuid,text,uuid,text,integer)'::regprocedure);
  anchor text := 'if r.id is not null then return r;end if;';
begin
  if strpos(d,anchor)=0 then raise exception 'REPORT_RESTART_DEFINITION_CHANGED'; end if;
  execute replace(d,anchor,anchor||$retry$
 select s.* into r from public.historical_report_runs s
 where s.establishment_id=p_establishment and s.organization_id=p_organization and s.language=p_language
 order by s.created_at desc,s.id desc limit 1;
 if r.status='failed' then
  select * into q from public.report_generation_requests where source_run_id=r.id;
  if q.engine='jev_sol_v2' and q.jev_transport='batch_initial_v1' then
   perform public.abandon_current_report_request(q.id,p_user,true);
  end if;
 end if;
$retry$);
end $$;

do $$
declare
  d text := pg_get_functiondef('private.pin_shared_jev_request()'::regprocedure);
  anchor text := $old$and exists(select 1 from private.shared_jev_runtime where enabled)$old$;
begin
  if strpos(d,anchor)=0 then raise exception 'REPORT_RESTART_PIN_DEFINITION_CHANGED'; end if;
  execute replace(d,anchor,anchor||$retry$
    and not exists (
      select 1 from public.report_generation_abandonments a where a.source_run_id=(
        select s.id from public.historical_report_runs s
        where s.establishment_id=new.establishment_id and s.organization_id=new.organization_id
          and s.language=new.language and s.id<>new.source_run_id
        order by s.created_at desc,s.id desc limit 1
      )
    )$retry$);
end $$;

-- A late projection cannot revive a terminal historical batch. Preserve
-- the independently deployed producer/consumer refresh deduplication.
do $$
declare
  d text := pg_get_functiondef('public.jev_batch_save_projection(uuid,text,jsonb,text,text)'::regprocedure);
  anchor text := 'select * into r from public.analysis_jev_batch_runs where id=t.run_id for update;';
begin
  if strpos(d,anchor)=0 then raise exception 'REPORT_RESTART_PROJECTION_DEFINITION_CHANGED'; end if;
  execute replace(d,anchor,anchor||$guard$
 if r.current_source_run_id is not null and (not r.armed or r.status<>'running') then return false; end if;
$guard$);
end $$;

do $$
declare
  d text := pg_get_functiondef('private.store_current_report_publication(jsonb,jsonb,timestamptz,boolean)'::regprocedure);
  anchor text := 'if is_stale and not p_recovery';
begin
  if strpos(d,anchor)=0 then raise exception 'REPORT_RESTART_PUBLICATION_DEFINITION_CHANGED'; end if;
  execute replace(d,anchor,$guard$
 if exists(select 1 from public.report_generation_abandonments where source_run_id=(p->>'current_source_run_id')::uuid)
 or exists(select 1 from public.historical_report_runs where id=(p->>'current_source_run_id')::uuid and status='failed')
 then return false; end if;
$guard$||anchor);
end $$;
