-- Validate the receipt against the specific build frozen at reservation.
do $$
declare
  d text;
  old_check text := $old$p_receipt->>'buildId' is distinct from 'Wck4NsSOTMrHCVoAk'$old$;
begin
  d:=pg_get_functiondef('public.observe_incremental_review_sync(uuid,text,text,jsonb,integer)'::regprocedure);
  if strpos(d,old_check)=0 then raise exception 'SYNC_RECEIPT_DEFINITION_CHANGED'; end if;
  execute replace(d,old_check,$new$not exists (
    select 1 from public.review_sync_jobs j where j.id=p_job and
      (j.incremental_build,p_receipt->>'buildId') in
      (('0.0.541','Wck4NsSOTMrHCVoAk'),('0.0.545','ZzXJ3FC9OUBCJxtza'))
  )$new$);
end $$;
