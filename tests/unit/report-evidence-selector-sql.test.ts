// @vitest-environment node
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterAll,afterEach,it,expect,vi} from 'vitest';
import {evidenceSelectorBinding,PRIORITY_SELECTOR_VERSION,MIXED_SELECTOR_VERSION} from '../../supabase/functions/_shared/report-evidence-selector';
import {DIRECT_COVERAGE_VERSION} from '../../supabase/functions/_shared/jev-direct-evidence-selection';
const org='00000000-0000-4000-8000-000000000001',est='00000000-0000-4000-8000-000000000002',actor='00000000-0000-4000-8000-000000000003';
const oldSource='00000000-0000-4000-8000-000000000010',oldRequest='00000000-0000-4000-8000-000000000011',intent='00000000-0000-4000-8000-000000000012';
const batch='00000000-0000-4000-8000-000000000013';
let db:PGlite,deny:ReturnType<typeof vi.spyOn>,beforeDefinitions:unknown,beforeRequests:unknown;
const query=async<T>(sql:string,params:unknown[]=[])=> (await db.query<T>(sql,params)).rows;
async function sha(body:unknown){return (await query<{sha:string}>('select public.jls_restaurant_hash($1::jsonb) sha',[JSON.stringify(body)]))[0].sha;}
async function enqueue(id=intent){return (await query<{id:string}>("select id from public.enqueue_current_report($1::uuid,$2::uuid,$3::uuid,'vi',$4::uuid,'gpt-6.1-sol',7)",[est,org,actor,id]))[0].id;}
async function switchTo(version=PRIORITY_SELECTOR_VERSION){return await query('select public.set_current_report_evidence_selector($1,$2)',[version,'EXPLICIT LOCAL TEST: change future requests only']);}
async function rejects(sql:string,params:unknown[],message:string){
 await db.exec('savepoint expected_rejection');await expect(db.query(sql,params)).rejects.toThrow(message);
 await db.exec('rollback to savepoint expected_rejection;release savepoint expected_rejection');
}
beforeAll(async()=>{
 deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'));db=new PGlite();await db.waitReady;
 await db.exec(readFileSync('tests/fixtures/current-batch-queue-before.sql','utf8'));
 await db.exec(`
 alter table public.report_pipeline_settings add column reason text default 'Before migration',add column updated_at timestamptz default now();
 create table public.report_pipeline_events(id bigint generated always as identity,engine text,jev_transport text,reason text);
 create table public.analysis_parallel_launch_preparations(id uuid primary key,authority_user_id uuid,organization_id uuid,current_source_run_id uuid,body jsonb,sha256 text);
 alter table public.analysis_jev_batch_runs add column manifest jsonb,add column manifest_sha256 text,add column template jsonb,
  add column draft jsonb,add column draft_sha256 text,add column draft_created_at timestamptz,add column stage text,add column armed boolean,
  add column envelope jsonb,add column snapshot_sha256 text;
 -- Test-only hash serialization. Production retains its unchanged canonical SHA.
 create function public.jls_restaurant_hash(p jsonb) returns text language sql immutable as 'select encode(sha256(convert_to(p::text,''utf8'')),''hex'')';
 -- The unchanged source certifier is deliberately inert here: this suite tests
 -- the added request-version boundary; real source validation has separate tests.
 create function public.check_parallel_protocol_comparison(p jsonb) returns boolean language sql as 'select true';
 create function public.jev_batch_wake(p uuid) returns bigint language plpgsql as $$declare n bigint;begin insert into public.test_dispatch(url,body,timeout_ms)values('LOCAL_ONLY',jsonb_build_object('id',p),0)returning id into n;return n;end$$;
 grant all on all tables in schema public to service_role;
 grant all on all sequences in schema public to service_role;
 `);
 const captured=JSON.parse(readFileSync('tests/fixtures/report-selector-functions-before.json','utf8'));
 for(const d of captured.definitions)await db.exec(d.definition);
 await db.exec('create trigger report_request_immutable before update or delete on public.report_generation_requests for each row execute function public.guard_report_request()');
 await db.query('insert into public.establishments values($1,$2,true)',[est,org]);
 await db.query("insert into public.organization_members values($1,$2,'owner')",[org,actor]);
 await db.exec("insert into public.report_pipeline_settings(id,engine,jev_transport)values(true,'jev_sol_v2','batch_initial_v1')");
 await db.query("insert into public.historical_report_runs(id,organization_id,establishment_id,status)values($1,$2,$3,'completed')",[oldSource,org,est]);
 await db.query("insert into public.report_generation_requests(id,organization_id,establishment_id,authority_user_id,language,engine,source_run_id,jev_transport)values($1,$2,$3,$4,'vi','jev_sol_v2',$5,'batch_initial_v1')",[oldRequest,org,est,actor,oldSource]);
 beforeDefinitions=await query("select proname,pg_get_functiondef(oid) definition from pg_proc where proname in('enqueue_current_report','claim_historical_report_jobs','guard_report_request') order by proname");
 await db.exec(readFileSync('supabase/migrations/20261026132413_pin_report_evidence_selector.sql','utf8'));
 // Represent both kinds of pre-existing request without activating anything.
 await db.exec("update public.report_pipeline_settings set evidence_selector_version='sol-evidence-single-negative-source-completion-proposal-v1'");
 await db.query("insert into public.historical_report_runs(id,organization_id,establishment_id,status)values('00000000-0000-4000-8000-000000000060',$1,$2,'completed')",[org,est]);
 await db.query("insert into public.report_generation_requests(id,organization_id,establishment_id,authority_user_id,language,engine,source_run_id,jev_transport)values('00000000-0000-4000-8000-000000000061',$1,$2,$3,'vi','jev_sol_v2','00000000-0000-4000-8000-000000000060','batch_initial_v1')",[org,est,actor]);
 await db.exec("update public.report_pipeline_settings set evidence_selector_version='jls-direct4-negative-mixed-coverage-v1'");
 beforeRequests=await query('select to_jsonb(q) body from public.report_generation_requests q order by id');
 await db.exec(readFileSync('supabase/migrations/20261026161509_pin_mixed_source_evidence_selector.sql','utf8'));

},30000);
beforeEach(async()=>{await db.exec('begin;set local role service_role');});
afterEach(async()=>{await db.exec('rollback');expect(deny).not.toHaveBeenCalled();});
afterAll(async()=>{await db.close();deny.mockRestore();});
it('ships unactivated and keeps existing requests, enqueue, claim and immutable guards intact',async()=>{
 expect(await query('select evidence_selector_version from public.report_pipeline_settings')).toEqual([{evidence_selector_version:DIRECT_COVERAGE_VERSION}]);
 expect(await query("select to_jsonb(q)-'evidence_selector_sha256' body from public.report_generation_requests q order by id")).toEqual(beforeRequests);
 expect(await query("select tgenabled from pg_trigger where tgname='report_request_immutable'")).toEqual([{tgenabled:'O'}]);
 expect(await query("select proname,pg_get_functiondef(oid) definition from pg_proc where proname in('enqueue_current_report','claim_historical_report_jobs','guard_report_request') order by proname")).toEqual(beforeDefinitions);
 expect(await query('select * from public.report_pipeline_events')).toEqual([]);expect(await query('select * from public.test_dispatch')).toEqual([]);
});
it('uses the same descriptor hashes as the deployed-code registry and disallows additional fields',async()=>{
 for(const version of [DIRECT_COVERAGE_VERSION,PRIORITY_SELECTOR_VERSION,MIXED_SELECTOR_VERSION]){
  const b=await evidenceSelectorBinding(version);
  expect(await query('select public.report_evidence_selector_sha($1) sha',[version])).toEqual([{sha:b.sha256}]);
  expect(await query('select public.report_evidence_selector_matches($1,$2::jsonb) ok',[version,JSON.stringify(b)])).toEqual([{ok:true}]);
  expect(await query('select public.report_evidence_selector_matches($1,$2::jsonb) ok',[version,JSON.stringify({...b,other:true})])).toEqual([{ok:false}]);
 }
});
it('pins the server choice at enqueue, ignores a caller override and keeps it after rollback of future settings',async()=>{
 await switchTo();const source=await enqueue();
 expect(await query('select evidence_selector_version from public.report_generation_requests where source_run_id=$1',[source])).toEqual([{evidence_selector_version:PRIORITY_SELECTOR_VERSION}]);
 const directSource='00000000-0000-4000-8000-000000000040',directRequest='00000000-0000-4000-8000-000000000041';
 await db.query("insert into public.historical_report_runs(id,organization_id,establishment_id,status)values($1,$2,$3,'completed')",[directSource,org,est]);
 await db.query("insert into public.report_generation_requests(id,organization_id,establishment_id,authority_user_id,language,engine,source_run_id,jev_transport,evidence_selector_version)values($1,$2,$3,$4,'vi','jev_sol_v2',$5,'batch_initial_v1',$6)",[directRequest,org,est,actor,directSource,DIRECT_COVERAGE_VERSION]);
 expect(await query('select evidence_selector_version from public.report_generation_requests where id=$1',[directRequest])).toEqual([{evidence_selector_version:PRIORITY_SELECTOR_VERSION}]);
 await switchTo(DIRECT_COVERAGE_VERSION);
 expect(await enqueue('00000000-0000-4000-8000-000000000020')).toBe(source);
 expect(await query('select evidence_selector_version from public.report_generation_requests where source_run_id=$1',[source])).toEqual([{evidence_selector_version:PRIORITY_SELECTOR_VERSION}]);
 await db.query("update public.historical_report_runs set status='completed' where id=$1",[source]);
 const future=await enqueue('00000000-0000-4000-8000-000000000021');
 expect(await query('select evidence_selector_version from public.report_generation_requests where source_run_id=$1',[future])).toEqual([{evidence_selector_version:DIRECT_COVERAGE_VERSION}]);
});
it('forbids changing the pinned version but permits the one existing report binding',async()=>{
 await switchTo();await enqueue();
 await rejects('update public.report_generation_requests set evidence_selector_version=$1 where id=$2',[DIRECT_COVERAGE_VERSION,intent],'REPORT_REQUEST_IMMUTABLE');
 await db.query('update public.report_generation_requests set comparison_id=$1 where id=$2',[batch,intent]);
 expect(await query('select comparison_id,evidence_selector_version from public.report_generation_requests where id=$1',[intent])).toEqual([{comparison_id:batch,evidence_selector_version:PRIORITY_SELECTOR_VERSION}]);
});
it('keeps a resumed claim on its original version and never touches unknown attempts or receipts when switching',async()=>{
 await switchTo();const source=await enqueue();
 await db.query("insert into public.analysis_jev_batch_tasks(run_id,status,request_count,receipt)values($1,'unknown',1,$2::jsonb)",[batch,JSON.stringify({technical_receipt:'EXPLICIT MOCK',outcome:'unknown'})]);
 const before=await query('select to_jsonb(t) row from public.analysis_jev_batch_tasks t');await switchTo(DIRECT_COVERAGE_VERSION);
 await db.exec("select * from public.claim_historical_report_jobs('00000000-0000-4000-8000-000000000030'::uuid,2)");
 expect(await query('select evidence_selector_version from public.report_generation_requests where source_run_id=$1',[source])).toEqual([{evidence_selector_version:PRIORITY_SELECTOR_VERSION}]);
 expect(await query('select to_jsonb(t) row from public.analysis_jev_batch_tasks t')).toEqual(before);
});
it('checks the request-bound version even for a matching immutable certificate',async()=>{
 await switchTo();const source=await enqueue(),generation='00000000-0000-4000-8000-000000000099';
 const b={organization_id:org,establishment_id:est,authority_user_id:actor,language:'vi',production_enabled:true,
  frozen_report:{ai_status:'source_frozen'},reference:{historical_run_id:source,generation_id:generation},
  current_delivery:{version:'jev-short-sol-compact-v2',request_id:intent,source_run_id:source,generation_id:generation},configuration:{evidence_selector:await evidenceSelectorBinding(PRIORITY_SELECTOR_VERSION)}};
 const valid=async(body:unknown)=>(await query<{ok:boolean}>('select public.check_parallel_protocol($1::jsonb) ok',[JSON.stringify(body)]))[0].ok;
 expect(await valid(b)).toBe(true);b.configuration.evidence_selector=await evidenceSelectorBinding();expect(await valid(b)).toBe(false);
 b.configuration.evidence_selector=await evidenceSelectorBinding(PRIORITY_SELECTOR_VERSION);b.configuration.evidence_selector.sha256='0'.repeat(64);expect(await valid(b)).toBe(false);
});
it('requires the pinned template when resuming an existing batch manifest and schedules no extra task',async()=>{
 await switchTo();const source=await enqueue(),binding=await evidenceSelectorBinding(PRIORITY_SELECTOR_VERSION);
 const manifest={configuration:{selector:binding},template:{evidence_selector:binding}},hash=await sha(manifest);
 await db.query("insert into public.analysis_jev_batch_runs(id,current_source_run_id,status,manifest,manifest_sha256)values($1,$2,'running',$3::jsonb,$4)",[batch,source,JSON.stringify(manifest),hash]);
 expect(await query('select public.jev_batch_create_current($1,$2::jsonb,$3) id',[source,JSON.stringify(manifest),hash])).toEqual([{id:batch}]);
 const changed={...manifest,template:{}};
 await rejects('select public.jev_batch_create_current($1,$2::jsonb,$3)',[source,JSON.stringify(changed),await sha(changed)],'CURRENT_BATCH_SELECTOR_CHANGED');
 expect(await query('select * from public.test_dispatch')).toEqual([]);expect(await query('select * from public.analysis_jev_batch_tasks')).toEqual([]);
});
it('seals a new priority draft once, rejects a selector switch and retains the saved body on duplicate',async()=>{
 const binding=await evidenceSelectorBinding(PRIORITY_SELECTOR_VERSION),request=JSON.stringify({model:'gpt-6.1-sol'});
 await db.query("insert into public.analysis_jev_batch_runs(id,status,stage,armed,template,snapshot_sha256)values($1,'running','prepare_evidence',true,$2::jsonb,'SYNTHETIC')",[batch,JSON.stringify({evidence_selector:binding})]);
 const body={compact_manifest:{source_snapshot_sha256:'SYNTHETIC'},request_json:request,request_sha256:await sha(JSON.parse(request)),evidence_selector:binding,selection:{version:PRIORITY_SELECTOR_VERSION}};
 const changed={...body,evidence_selector:await evidenceSelectorBinding()};
 await rejects('select public.jev_batch_save_draft($1,$2::jsonb,$3)',[batch,JSON.stringify(changed),await sha(changed)],'BATCH_EVIDENCE_SELECTOR_CHANGED');
 const save=async()=>await query('select public.jev_batch_save_draft($1,$2::jsonb,$3) saved',[batch,JSON.stringify(body),await sha(body)]);
 expect(await save()).toEqual([{saved:true}]);expect(await save()).toEqual([{saved:true}]);
 expect(await query('select draft from public.analysis_jev_batch_runs')).toEqual([{draft:body}]);expect((await query('select * from public.test_dispatch')).length).toBe(1);
});
it('keeps the switch service-only, rejects unknown versions, and creates one audit event per effective change',async()=>{
 for(const role of ['anon','authenticated'])expect(await query('select has_function_privilege($1,$2,$3) ok',[role,'public.set_current_report_evidence_selector(text,text)','EXECUTE'])).toEqual([{ok:false}]);
 await rejects("select public.set_current_report_evidence_selector('unknown','EXPLICIT LOCAL TEST')",[],'FORBIDDEN');
 await switchTo();await switchTo();expect((await query('select * from public.report_pipeline_events')).length).toBe(1);
 expect(await query('select * from public.test_dispatch')).toEqual([]);
});
it('fills both version and hash at creation, overwrites caller values, and keeps old bindings after rollback',async()=>{
 await switchTo(MIXED_SELECTOR_VERSION);const source=await enqueue(),mixed=await evidenceSelectorBinding(MIXED_SELECTOR_VERSION);
 expect(await query('select evidence_selector_version,evidence_selector_sha256 from public.report_generation_requests where source_run_id=$1',[source]))
  .toEqual([{evidence_selector_version:mixed.version,evidence_selector_sha256:mixed.sha256}]);
 await rejects('update public.report_generation_requests set evidence_selector_sha256=$1 where id=$2',['0'.repeat(64),intent],'REPORT_REQUEST_IMMUTABLE');
 await switchTo(PRIORITY_SELECTOR_VERSION);
 expect(await enqueue('00000000-0000-4000-8000-000000000070')).toBe(source);
 expect(await query('select evidence_selector_sha256 from public.report_generation_requests where source_run_id=$1',[source])).toEqual([{evidence_selector_sha256:mixed.sha256}]);
 await db.query("update public.historical_report_runs set status='completed' where id=$1",[source]);
 const future=await enqueue('00000000-0000-4000-8000-000000000071'),prior=await evidenceSelectorBinding(PRIORITY_SELECTOR_VERSION);
 expect(await query('select evidence_selector_version,evidence_selector_sha256 from public.report_generation_requests where source_run_id=$1',[future]))
  .toEqual([{evidence_selector_version:prior.version,evidence_selector_sha256:prior.sha256}]);
 const directSource='00000000-0000-4000-8000-000000000072';
 await db.query("insert into public.historical_report_runs(id,organization_id,establishment_id,status)values($1,$2,$3,'completed')",[directSource,org,est]);
 await db.query("insert into public.report_generation_requests(id,organization_id,establishment_id,authority_user_id,language,engine,source_run_id,jev_transport,evidence_selector_version,evidence_selector_sha256)values('00000000-0000-4000-8000-000000000073',$1,$2,$3,'vi','jev_sol_v2',$4,'batch_initial_v1',$5,$6)",[org,est,actor,directSource,MIXED_SELECTOR_VERSION,'0'.repeat(64)]);
 expect(await query('select evidence_selector_version,evidence_selector_sha256 from public.report_generation_requests where source_run_id=$1',[directSource]))
  .toEqual([{evidence_selector_version:prior.version,evidence_selector_sha256:prior.sha256}]);
});
it('matches the creation-time hash as well as the descriptor and checks the new helper permissions',async()=>{
 const b=await evidenceSelectorBinding(MIXED_SELECTOR_VERSION);
 for(const [sha,descriptor,expected] of [[b.sha256,b,true],['0'.repeat(64),b,false],[b.sha256,{...b,sha256:'0'.repeat(64)},false]] as const)
  expect(await query('select public.report_request_evidence_selector_matches($1,$2,$3::jsonb) ok',[b.version,sha,JSON.stringify(descriptor)])).toEqual([{ok:expected}]);
 for(const role of ['anon','authenticated'])expect(await query('select has_function_privilege($1,$2,$3) ok',[role,'public.report_request_evidence_selector_matches(text,text,jsonb)','EXECUTE'])).toEqual([{ok:false}]);
});
