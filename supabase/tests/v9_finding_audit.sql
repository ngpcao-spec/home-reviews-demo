-- Synthetic rollback-only checks: no real finding selection, source mutation or provider calls.
begin;
do $$
declare fixture_id uuid:=gen_random_uuid();item_id uuid;actor uuid;org uuid;est uuid;rev integer:=0;rejected boolean;table_name text;
begin
  for table_name in select unnest(array['analysis_v9_finding_audits','analysis_v9_finding_audit_items','analysis_v9_finding_audit_labels','analysis_v9_finding_audit_events']) loop
    if has_table_privilege('anon','public.'||table_name,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','public.'||table_name,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'private table grants failed';end if;
    if not (select relrowsecurity from pg_class where oid=('public.'||table_name)::regclass) then raise exception 'RLS failed';end if;
  end loop;
  if has_function_privilege('authenticated','public.create_v9_finding_audit(uuid,jsonb,jsonb,text,jsonb)','EXECUTE') or has_function_privilege('anon','public.write_v9_finding_audit(uuid,uuid,integer,text,jsonb)','EXECUTE') then raise exception 'private RPC grants failed';end if;
  select m.user_id,e.organization_id,e.id into actor,org,est from public.establishments e join public.organization_members m on m.organization_id=e.organization_id where m.role in ('owner','admin','manager') limit 1;
  if actor is null then raise exception 'fixture actor required';end if;
  insert into public.analysis_v9_finding_audits(id,organization_id,establishment_id,source_v8_generation_id,source_v9_generation_id,taxonomy,source_fingerprint,selection_metadata,created_by)
    values(fixture_id,org,est,gen_random_uuid(),gen_random_uuid(),'{}',repeat('0',64),'{"synthetic":true}',actor);
  -- Authorization checked again inside the RPC, not just at the Edge boundary.
  rejected=false;begin perform public.write_v9_finding_audit(gen_random_uuid(),fixture_id,0,'finalize','{}');exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;rejected=true;end;if not rejected then raise exception 'unauthorized actor accepted';end if;
  rejected=false;begin perform public.write_v9_finding_audit(actor,fixture_id,0,'finalize','{"comparison":{}}');exception when others then if sqlerrm<>'FINDING_AUDIT_INCOMPLETE' then raise;end if;rejected=true;end;if not rejected then raise exception 'incomplete accepted';end if;
  for n in 1..30 loop
    insert into public.analysis_v9_finding_audit_items(audit_id,review_id,theme_key,sentiment,position,analysis_text_sha256,selection_hash,probability_positive,probability_negative,repeat_stable)
      values(fixture_id,gen_random_uuid(),'attentiveness','positive',n,repeat('0',64),repeat('0',64),.75,.05,true) returning id into item_id;
    rev=public.write_v9_finding_audit(actor,fixture_id,rev,'save_choice',jsonb_build_object('item_id',item_id,'choice',case when n=1 then 'uncertain' else 'absent' end));
  end loop;
  if rev<>30 or (select count(*) from public.analysis_v9_finding_audit_labels where audit_id=fixture_id)<>30 then raise exception 'autosave failed';end if;
  rejected=false;begin perform public.write_v9_finding_audit(actor,fixture_id,0,'save_choice',jsonb_build_object('item_id',item_id,'choice','both'));exception when others then if sqlerrm<>'FINDING_AUDIT_REVISION_CHANGED' then raise;end if;rejected=true;end;if not rejected then raise exception 'stale revision accepted';end if;
  rev=public.write_v9_finding_audit(actor,fixture_id,rev,'save_choice',jsonb_build_object('item_id',item_id,'choice','both'));
  if (select count(*) from public.analysis_v9_finding_audit_labels where audit_id=fixture_id)<>30 then raise exception 'correction duplicated label';end if;
  if (select count(*) from public.analysis_v9_finding_audit_events where audit_id=fixture_id and payload->>'previous_choice'='absent' and payload->>'choice'='both')<>1 then raise exception 'audit history failed';end if;
  perform public.write_v9_finding_audit(actor,fixture_id,rev,'finalize','{"comparison":{"synthetic":true}}');
  rejected=false;begin perform public.write_v9_finding_audit(actor,fixture_id,rev+1,'save_choice',jsonb_build_object('item_id',item_id,'choice','negative'));exception when others then if sqlerrm<>'FINDING_AUDIT_IMMUTABLE' then raise;end if;rejected=true;end;if not rejected then raise exception 'completed RPC mutable';end if;
  rejected=false;begin update public.analysis_v9_finding_audit_labels set choice='positive' where audit_id=fixture_id;exception when others then if sqlerrm<>'FINDING_AUDIT_IMMUTABLE' then raise;end if;rejected=true;end;if not rejected then raise exception 'completed labels mutable';end if;
  rejected=false;begin update public.analysis_v9_finding_audits set comparison='{}' where id=fixture_id;exception when others then if sqlerrm<>'FINDING_AUDIT_IMMUTABLE' then raise;end if;rejected=true;end;if not rejected then raise exception 'completed parent mutable';end if;
  rejected=false;begin delete from public.analysis_v9_finding_audit_items where audit_id=fixture_id;exception when others then if sqlerrm<>'FINDING_AUDIT_IMMUTABLE' then raise;end if;rejected=true;end;if not rejected then raise exception 'completed items mutable';end if;
end $$;
rollback;
select 'finding audit synthetic RPC/RLS/immutability checks passed; transaction rolled back' result;
