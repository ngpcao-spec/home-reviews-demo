// @vitest-environment node
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {it,expect,vi} from 'vitest';
it('rolls back the metadata backfill and restores the original guard if a SQL compatibility anchor fails',async()=>{
 const deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN')),db=new PGlite();
 try{
 await db.waitReady;
 await db.exec(`
 create table public.report_pipeline_settings(id boolean primary key,evidence_selector_version text
  constraint report_pipeline_settings_evidence_selector_version_check check(evidence_selector_version in('sol-evidence-single-negative-source-completion-proposal-v1')));
 create table public.report_generation_requests(id integer primary key,evidence_selector_version text
  constraint report_generation_requests_evidence_selector_version_check check(evidence_selector_version in('sol-evidence-single-negative-source-completion-proposal-v1')));
 create function public.guard_report_request() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE_TEST_GUARD';end$$;
 create trigger report_request_immutable before update on public.report_generation_requests for each row execute function public.guard_report_request();
 create function public.report_evidence_selector_sha(p_version text) returns text language sql immutable as $$select repeat('a',64)$$;
 create function public.report_evidence_selector_matches(p text,b jsonb) returns boolean language sql immutable as $$select true$$;
 -- Deliberately incompatible source validator. The migration must fail closed.
 create function public.check_parallel_protocol(b jsonb) returns boolean language sql as $$select true$$;
 insert into public.report_pipeline_settings values(true,'sol-evidence-single-negative-source-completion-proposal-v1');
 insert into public.report_generation_requests values(1,'sol-evidence-single-negative-source-completion-proposal-v1');
 `);
 const before=await db.query('select to_jsonb(q) body from public.report_generation_requests q');
 await expect(db.exec(readFileSync('supabase/migrations/20261026161509_pin_mixed_source_evidence_selector.sql','utf8'))).rejects.toThrow('MIXED_SELECTOR_PROTOCOL_ANCHOR_CHANGED');
 await db.exec('rollback');
 expect((await db.query('select to_jsonb(q) body from public.report_generation_requests q')).rows).toEqual(before.rows);
 expect((await db.query("select tgenabled from pg_trigger where tgname='report_request_immutable'")).rows).toEqual([{tgenabled:'O'}]);
 expect((await db.query("select count(*)::int n from information_schema.columns where table_name='report_generation_requests' and column_name='evidence_selector_sha256'")).rows).toEqual([{n:0}]);
 expect((await db.query("select evidence_selector_version from public.report_pipeline_settings")).rows).toEqual([{evidence_selector_version:'sol-evidence-single-negative-source-completion-proposal-v1'}]);
 expect((await db.query("select public.report_evidence_selector_sha('sol-evidence-single-negative-source-completion-proposal-v1') sha")).rows).toEqual([{sha:'a'.repeat(64)}]);
 expect(deny).not.toHaveBeenCalled();
 }finally{await db.close();deny.mockRestore();}
},30000);
