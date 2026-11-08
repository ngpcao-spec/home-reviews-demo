-- The producer is refreshed immediately above the consumer fan-out.
-- Skip it in that fan-out to avoid hashing the same report twice.
do $$
declare
  d text := pg_get_functiondef('public.jev_batch_save_projection(uuid,text,jsonb,text,text)'::regprocedure);
  anchor text := $old$perform public.jev_shared_refresh(br.id) from public.analysis_jev_batch_runs br where br.armed$old$;
begin
  if strpos(d,anchor)=0 then raise exception 'JEV_PROJECTION_REFRESH_DEFINITION_CHANGED'; end if;
  execute replace(d,anchor,replace(anchor,'where br.armed','where br.id<>r.id and br.armed'));
end $$;
