-- Sol's durable receipt is the native HTTP body, not a top-level usage object.
-- Preserve its real cache-write counter as well as cache reads.
do $$declare d text;a text;begin
 d=pg_get_functiondef('private.record_retention_attempt(text,jsonb)'::regprocedure);
 a='if u is null and rec->>''raw_response_text'' like ''{%'' then begin src=(rec->>''raw_response_text'')::jsonb;u=src->''usage'';exception when others then u=null;end;end if;';
 if position(a in d)=0 then raise exception 'RETENTION_NATIVE_USAGE_CHANGED';end if;
 d=replace(d,a,'if rec->>''raw_response_text'' like ''{%'' then begin src=(rec->>''raw_response_text'')::jsonb;u=coalesce(src->''usage'',u);exception when others then null;end;end if;');
 d=replace(d,'private.retention_number(u,''cache_creation_input_tokens''),coalesce','coalesce(private.retention_number(u,''cache_creation_input_tokens''),private.retention_number(u->''input_tokens_details'',''cache_write_tokens'')),coalesce');
 execute d;
end $$;
-- Backfill only bookkeeping, never reserve or send a provider request.
select private.record_retention_attempt('public.analysis_jev_batch_runs',to_jsonb(b)) from public.analysis_jev_batch_runs b where sol_request_count>0;
