do $$
declare
  d text := pg_get_functiondef('public.enqueue_current_report(uuid,uuid,uuid,text,uuid,text,integer)'::regprocedure);
  anchor text := $old$if r.status='failed' then$old$;
begin
  if strpos(d,anchor)=0 then raise exception 'REPORT_MANUAL_RESTART_DEFINITION_CHANGED'; end if;
  execute replace(d,anchor,anchor||$guard$
  if nullif(current_setting('home.auto_report_reference',true),'') is not null then
   raise exception 'REPORT_MANUAL_RESTART_REQUIRED';
  end if;
$guard$);
end $$;
