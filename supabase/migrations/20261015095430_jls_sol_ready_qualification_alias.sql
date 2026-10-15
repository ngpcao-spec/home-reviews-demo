CREATE OR REPLACE FUNCTION public.qualify_jls_sol_ready(p_sha text, p_body jsonb, p_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a public.analysis_jls_sol_ready_artifacts;rid uuid;m jsonb;begin
 if current_user<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into a from public.analysis_jls_sol_ready_artifacts where sha256=p_sha;
 if a.id is null or p_hash<>public.jls_restaurant_hash(p_body) or p_body->>'provider_calls' is distinct from '0'
 or p_body->>'full_worker_path' is distinct from 'true' or jsonb_array_length(p_body->'measurements')<2 then raise exception 'JLS_READY_QUALIFICATION_INVALID';end if;
 for m in select value from jsonb_array_elements(p_body->'measurements') loop
 if (m->>'cpu_ms')::int not between 1 and 1500 or (m->>'memory_bytes')::bigint not between 1 and 268435455
 or m->>'source'<>'supabase_native_Shutdown' or not exists(select 1 from public.analysis_jls_sol_ready_operations o
 where o.id=(m->>'operation_id')::uuid and o.artifact_id=a.id and o.mode='mock' and o.request_count=1 and o.receipt is not null
 and o.result is not null and o.status in('completed','needs_review')) then raise exception 'JLS_READY_MARGIN_INSUFFICIENT';end if;
 end loop;
 if not exists(select 1 from jsonb_array_elements(p_body->'measurements') measured(value) where measured.value->>'phase'='sol')
 or not exists(select 1 from jsonb_array_elements(p_body->'measurements') measured(value) where measured.value->>'phase'='validate_sol') then raise exception 'JLS_READY_PHASE_NOT_MEASURED';end if;
 insert into public.analysis_jls_sol_ready_checks(organization_id,artifact_id,body,sha256) values(a.organization_id,a.id,p_body,p_hash)
 on conflict(artifact_id) do nothing returning id into rid;
 if rid is null then select id into rid from public.analysis_jls_sol_ready_checks where artifact_id=a.id and sha256=p_hash;end if;
 if rid is null then raise exception 'JLS_READY_QUALIFICATION_IMMUTABLE';end if;return rid;end $function$;
