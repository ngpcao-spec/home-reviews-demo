-- Administrative delegation enters the SAME application queue as the explicit
-- button, with its own truthful consent provenance. No supplier transport here.
create function public.check_parallel_delegation(p jsonb,h text,c jsonb) returns boolean
language plpgsql stable set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 return coalesce(p->>'version'='jls-direct4-parallel-no-luna-v1' and public.check_parallel_protocol(p)
 and h=public.jls_restaurant_hash(p) and c->>'consent_source'='user_directive_codex_delegation'
 and c->>'protocol_sha256'=h and c->>'source_snapshot_sha256'=p->>'source_snapshot_sha256'
 and c->>'reference_report_id'=p#>>'{reference,report_id}'
 and c->>'pending_sha256'=p->>'pending_sha256'
 and c->'operator_identity'='{"kind":"codex_admin","channel":"supabase_mcp"}'::jsonb
 and length(c->>'user_directive')>40
 and c->>'directive_sha256'=encode(extensions.digest(c->>'user_directive','sha256'),'hex')
 and abs(extract(epoch from now()-(c->>'requested_at')::timestamptz))<=300
 and (c->>'expires_at')::timestamptz>now() and (c->>'expires_at')::timestamptz<=now()+interval '24 hours'
 and c->'scope'=jsonb_build_object('organization_id',p->'organization_id','establishment_id',p->'establishment_id','language',p->'language',
 'configuration_sha256',p->'configuration_sha256','max_jev_calls',p->'max_jev_calls','max_luna_calls',0,'max_sol_calls',1,'max_apify_calls',0,
 'automatic_retry',false,'provider_client_retries',0),false);
exception when invalid_text_representation or datetime_field_overflow then return false;
end $$;

-- Move the existing starter into one shared implementation. The original
-- three-argument RPC stays byte-compatible for the application's button.
do $$declare d text;anchor text;at1 int;at2 int;legacy text;begin
 d=pg_get_functiondef('public.start_parallel_report(jsonb,text,uuid)'::regprocedure);
 anchor='FUNCTION public.start_parallel_report(p_body jsonb, p_sha text, p_user uuid)';
 if position(anchor in d)=0 then raise exception 'PARALLEL_START_SIGNATURE_CHANGED';end if;
 d=replace(d,anchor,'FUNCTION public.start_parallel_report_internal(p_body jsonb, p_sha text, p_user uuid, p_delegation jsonb)');
 anchor='if current_user<>''service_role'' then raise exception ''FORBIDDEN'';end if;';
 if position(anchor in d)=0 then raise exception 'PARALLEL_START_ROLE_CHANGED';end if;
 d=replace(d,anchor,anchor||' if p_delegation is not null and not public.check_parallel_delegation(p_body,p_sha,p_delegation) then raise exception ''PARALLEL_DELEGATION_INVALID'';end if;');
 at1=position('c=jsonb_build_object(''consent_source'',''user_in_app_button''' in d);
 at2=position(' insert into public.analysis_jls_restaurant_runs(' in d);
 if at1=0 or at2<=at1 then raise exception 'PARALLEL_CONSENT_ANCHOR_CHANGED';end if;
 legacy=substring(d from at1 for at2-at1);
 d=substring(d from 1 for at1-1)||'if p_delegation is null then '||legacy||
 'else c=p_delegation||jsonb_build_object(''protocol_id'',p,''authority_user_id'',p_user);end if; '||substring(d from at2);
 anchor='now()+interval ''24 hours'') returning id into r';
 if position(anchor in d)=0 then raise exception 'PARALLEL_EXPIRY_ANCHOR_CHANGED';end if;
 d=replace(d,anchor,'(c->>''expires_at'')::timestamptz) returning id into r');
 execute d;
end $$;
create or replace function public.start_parallel_report(p_body jsonb,p_sha text,p_user uuid) returns uuid
language sql set search_path='' as $$select public.start_parallel_report_internal(p_body,p_sha,p_user,null)$$;

create function public.start_parallel_report_delegated(p_body jsonb,p_sha text,p_consent jsonb,p_consent_sha text) returns uuid
language plpgsql set search_path='' as $$begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_consent_sha is distinct from public.jls_restaurant_hash(p_consent) or not public.check_parallel_delegation(p_body,p_sha,p_consent)
 then raise exception 'PARALLEL_DELEGATION_INVALID';end if;
 return public.start_parallel_report_internal(p_body,p_sha,(p_body->>'authority_user_id')::uuid,p_consent);
end $$;
revoke all on function public.check_parallel_delegation(jsonb,text,jsonb),public.start_parallel_report_internal(jsonb,text,uuid,jsonb),public.start_parallel_report_delegated(jsonb,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.check_parallel_delegation(jsonb,text,jsonb),public.start_parallel_report_internal(jsonb,text,uuid,jsonb),public.start_parallel_report_delegated(jsonb,text,jsonb,text) to service_role;
