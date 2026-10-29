-- A reload removes the reference; terminal automatic authorizations cannot retry.
-- Retire only their check queue entries, never the authorization/receipt fences.
begin;
do $patch$ declare d text;a text;begin
 d=pg_get_functiondef('private.maybe_refresh_report(uuid,text)'::regprocedure);
 a='then return ''manual_reference_required'';end if;';
 if position(a in d)=0 then raise exception 'REFRESH_REFERENCE_CHECK_DRIFT';end if;
 d=replace(d,a,'then delete from private.automatic_report_checks where establishment_id=p_establishment and language=p_language;return ''manual_reference_required'';end if;');
 a='then return ''already_authorized'';end if;';
 if position(a in d)=0 then raise exception 'REFRESH_AUTHORIZATION_CHECK_DRIFT';end if;
 execute replace(d,a,'then delete from private.automatic_report_checks where establishment_id=p_establishment and language=p_language;return ''already_authorized'';end if;');
end $patch$;
commit;
