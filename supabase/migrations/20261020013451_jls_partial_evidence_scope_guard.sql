-- Missing sources are audit-only. Disable JIT for this short JSON validation
-- RPC; no statement/lock timeout is changed and no result is rewritten.
do $$declare d text;before text;after text;begin
 d=pg_get_functiondef('public.bind_jls_direct4_historical_evidence(uuid,jsonb,text)'::regprocedure);
 before='for v in select value from jsonb_array_elements(prep->''body''->''selection''->''selected'') loop';
 after=before||' if exists(select 1 from jsonb_array_elements(p.body->''continuation''->''missing'') m where m->>''review_id''=v->>''review_id'') then return false;end if;';
 if position(before in d)=0 then raise exception 'PARTIAL_SELECTED_GUARD_NOT_FOUND';end if;
 execute replace(d,before,after);
end $$;
alter function public.bind_jls_direct4_historical_evidence(uuid,jsonb,text) set jit='off';
