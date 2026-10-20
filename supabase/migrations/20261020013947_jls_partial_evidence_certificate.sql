-- Split deterministic JSON hashing from the atomic source-binding transaction.
-- Reuses the immutable preparations store. No provider, run or consent created.
create function public.save_jls_direct4_partial_evidence_certificate(p_run uuid,p_body jsonb,p_sha text) returns uuid
language plpgsql set search_path='' set jit='off' as $$
declare r public.analysis_jls_restaurant_runs;p public.analysis_jls_restaurant_protocols;rid uuid;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into r from public.analysis_jls_restaurant_runs where id=p_run;
 select * into p from public.analysis_jls_restaurant_protocols where id=r.protocol_id;
 if r.id is null or not(p.body?'continuation') or r.stage<>'prepare_evidence' or not public.jls_restaurant_valid(r.id)
 or p_body->>'protocol_sha256' is distinct from p.sha256 or p_sha is distinct from public.jls_restaurant_hash(p_body)
 or p_body->'dataset'->>'sha256' is distinct from public.jls_restaurant_hash(p_body->'dataset'->'body')
 or p_body->'preparation'->>'sha256' is distinct from public.jls_restaurant_hash(p_body->'preparation'->'body') then raise exception 'JLS_PARTIAL_CERTIFICATE_INVALID';end if;
 insert into public.analysis_jls_snapshot_preparations(organization_id,protocol_id,kind,body,sha256)
 values(r.organization_id,p.id,'partial_evidence_verified_'||p_sha,p_body,p_sha) on conflict(protocol_id,kind) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_snapshot_preparations where protocol_id=p.id and kind='partial_evidence_verified_'||p_sha and body=p_body and sha256=p_sha;end if;
 if rid is null then raise exception 'JLS_PARTIAL_CERTIFICATE_CONFLICT';end if;return rid;
end $$;
revoke all on function public.save_jls_direct4_partial_evidence_certificate(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_jls_direct4_partial_evidence_certificate(uuid,jsonb,text) to service_role;
do $$declare d text;before text;after text;begin
 d=pg_get_functiondef('public.bind_jls_direct4_historical_evidence(uuid,jsonb,text)'::regprocedure);
 before='if not public.jls_restaurant_valid(r.id)';
 after='if p.body?''continuation'' and not exists(select 1 from public.analysis_jls_snapshot_preparations cert where cert.protocol_id=p.id and cert.organization_id=r.organization_id and cert.kind=''partial_evidence_verified_''||p_sha and cert.sha256=p_sha and cert.body=p_body) then return false;end if; '||before;
 if position(before in d)=0 then raise exception 'PARTIAL_CERTIFICATE_GUARD_NOT_FOUND';end if;d=replace(d,before,after);
 foreach before in array array['p_sha<>public.jls_restaurant_hash(p_body)',
  'p_body->''dataset''->>''sha256''<>public.jls_restaurant_hash(p_body->''dataset''->''body'')',
  'prep->>''sha256''<>public.jls_restaurant_hash(prep->''body'')'] loop
  if position(before in d)=0 then raise exception 'PARTIAL_CERTIFICATE_HASH_NOT_FOUND';end if;
  d=replace(d,before,'(not(p.body?''continuation'') and ('||before||'))');
 end loop;execute d;
 -- The generic archive writer cannot mint a verified certificate.
 d=pg_get_functiondef('public.save_jls_snapshot_preparation(uuid,text,jsonb,text)'::regprocedure);
 before='begin';after='begin if p_kind like ''partial_evidence_verified_%'' then raise exception ''JLS_CERTIFICATE_RPC_REQUIRED'';end if;';
 execute regexp_replace(d,before,after);
end $$;
