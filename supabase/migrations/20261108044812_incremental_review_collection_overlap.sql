-- The provider window can start earlier than the local import window.
do $$
declare
  d text;
  old_check text := $old$p_build is distinct from '0.0.541'$old$;
  old_date text := $old$j.checkpoint_review_at-interval '5 seconds' then raise exception 'SYNC_INCREMENTAL_INPUT_MISMATCH'$old$;
  old_commit text := $old$j.incremental_input->>'reviewsStartDate' is distinct from p_result->>'since'$old$;
  overlap text := $sql$case when %s='0.0.545' then interval '24 hours' else interval '5 seconds' end$sql$;
begin
  d:=pg_get_functiondef('public.reserve_incremental_review_sync(uuid,text,jsonb,text)'::regprocedure);
  if strpos(d,old_check)=0 or strpos(d,old_date)=0 then raise exception 'SYNC_RESERVATION_DEFINITION_CHANGED'; end if;
  d:=replace(d,old_check,$sql$coalesce(p_build,'') not in ('0.0.541','0.0.545')$sql$);
  execute replace(d,old_date,format($sql$j.checkpoint_review_at-(%s) then raise exception 'SYNC_INCREMENTAL_INPUT_MISMATCH'$sql$,format(overlap,'p_build')));

  d:=pg_get_functiondef('public.commit_incremental_review_sync(uuid,text,jsonb,jsonb)'::regprocedure);
  if strpos(d,old_commit)=0 then raise exception 'SYNC_COMMIT_DEFINITION_CHANGED'; end if;
  execute replace(d,old_commit,format($sql$coalesce(j.incremental_build,'') not in ('0.0.541','0.0.545') or
    (j.incremental_input->>'reviewsStartDate')::timestamptz is distinct from j.checkpoint_review_at-(%s)$sql$,format(overlap,'j.incremental_build')));
end $$;
