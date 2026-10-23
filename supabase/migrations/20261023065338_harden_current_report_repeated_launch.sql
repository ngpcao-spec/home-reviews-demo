-- A repeated wake re-reads the immutable intent after the scope lock. A second
-- transaction can only return the already-bound publication, never queue again.
do $$declare d text;a text;begin
 d=pg_get_functiondef('public.start_parallel_report_internal(jsonb,text,uuid,jsonb)'::regprocedure);
 a=' select * into pair from public.analysis_parallel_reports where reference_report_id=cur.id';
 if position(a in d)=0 then raise exception 'CURRENT_IDEMPOTENCE_ANCHOR_CHANGED';end if;
 execute replace(d,a,' if is_current then
  select * into rq from public.report_generation_requests where id=rq.id for update;
  if rq.comparison_id is not null then return rq.comparison_id;end if;
 end if;'||a);
end $$;
