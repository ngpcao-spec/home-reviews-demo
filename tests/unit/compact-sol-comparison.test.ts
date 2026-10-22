import {beforeAll,it,expect,vi} from 'vitest';
import {compactComparisonFixture} from '../fixtures/compact-sol-comparison';
import {verifyCompactComparison,prepareCompactComparison,compactComparisonMock,type CompactComparison} from '../../supabase/functions/_shared/compact-sol-comparison';
import {candidateExecutionContract} from '../../supabase/functions/_shared/jls-direct4-candidates-server';
import {directHash} from '../../supabase/functions/_shared/jev-direct-categories';
import {compactSolInstructions} from '../../supabase/functions/_shared/parallel-sol-wire';
import {snapshotReadyMock} from '../../supabase/functions/_shared/jls-snapshot-v2-probe';
import {processReadySol,type ReadyState} from '../../supabase/functions/_shared/jls-sol-ready-worker';
let fixture:Awaited<ReturnType<typeof compactComparisonFixture>>,p:CompactComparison;
beforeAll(async()=>{fixture=await compactComparisonFixture();p=fixture.protocol;},30000);
async function state(){const run=crypto.randomUUID(),pid=crypto.randomUUID(),a=p.body.ready_template,b={version:'jls-direct4-sol-ready-v1',source_protocol_id:pid,source_protocol_sha256:p.sha256,source_run_id:run,candidate_template:a,
 sol:{gate:{passed:true,scope:'technical_candidate_sources_not_semantic_acceptance'},draft:a.draft},request_json:a.request_json,request_sha256:a.request_sha256,request_raw_sha256:a.request_raw_sha256,measurement:a.measurement,token_certificate:a.token_certificate,token_certificate_sha256:a.token_certificate_sha256};
 return snapshotReadyMock({protocol:{id:pid,...structuredClone(p)},ready:{body:b,sha256:await directHash(b)},operation:{id:crypto.randomUUID(),organization_id:p.body.organization_id,mode:'mock',run_id:run,status:'queued',phase:'sol',request_count:0,worker:null,receipt:null,receipt_sha256:null,result:null}} as unknown as ReadyState);
}
it('preserves frozen classifications, evidence, current prompt/model/reasoning and stores no paid authorization',async()=>{
 await verifyCompactComparison(p.body,p.sha256);expect(p.body.pending).toEqual([]);expect([p.body.max_jev_calls,p.body.max_luna_calls,p.body.max_sol_calls,p.body.max_apify_calls]).toEqual([0,0,1,0]);
 expect(p.body.ready_template.draft.prompt).toBe(compactSolInstructions('vi'));expect(p.body.ready_template.draft.request.reasoning.effort).toBe('low');expect(p.body.ready_template.draft.packet.associations).toHaveLength(32);expect(p.body.review_metadata).toHaveLength(75);
 expect(p.body.spending_authorization).toBeNull();expect(p.body.run_id).toBeNull();expect(p.body.source.selected).toEqual(fixture.archive.body.protocol.body.source.selected);
 expect((await prepareCompactComparison(fixture.archive,'a'.repeat(40))).sha256).toBe(p.sha256);
});
it('uses one shared dispatch under concurrent wakes and saves raw/reconstructed results',async()=>{
 const f=await state(),http=vi.fn(async()=>new Response(JSON.stringify(compactComparisonMock(p.body))));
 await Promise.all(Array.from({length:5},()=>processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',http,candidateExecutionContract)));
 await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',http,candidateExecutionContract);await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',http,candidateExecutionContract);
 expect(http).toHaveBeenCalledTimes(1);expect(f.state.operation.status).toBe('completed');expect(f.state.operation.result?.validated_report).toBeTruthy();expect(f.state.operation.receipt?.raw_response_text).toBeTruthy();
});
it.each(['timeout','invalid','unknown_ref','missing_usage','wrong_model'])('never retries a %s attempt',async kind=>{
 const f=await state(),http=vi.fn(async()=>{if(kind==='timeout')throw Error('TIMEOUT');const raw=compactComparisonMock(p.body);
  if(kind==='missing_usage')delete (raw as {usage?:unknown}).usage;if(kind==='wrong_model')raw.model='wrong';
  if(kind==='unknown_ref'){const out=JSON.parse(raw.output[0].content[0].text);out.report.conclusion.refs=['e999'];raw.output[0].content[0].text=JSON.stringify(out);}
  return new Response(kind==='invalid'?'{bad':JSON.stringify(raw));
 });
 for(let i=0;i<4;i++)await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',http,candidateExecutionContract);
 expect(http).toHaveBeenCalledTimes(1);expect(f.state.operation.status).not.toBe('completed');expect(f.state.operation.receipt).toBeTruthy();
});
it.each(['source','metadata','request','scope'])('blocks changed %s before any dispatch',async kind=>{
 const f=await state(),body=f.state.protocol.body as unknown as CompactComparison['body'];
 if(kind==='source')body.source.selected[0].quote+='changed';if(kind==='metadata')body.review_metadata[0].analysis_language='changed';
 if(kind==='request')body.ready_template.request_json+=' ';if(kind==='scope')body.establishment_id=crypto.randomUUID();
 const http=vi.fn(async()=>new Response('{}'));await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',http,candidateExecutionContract);expect(http).not.toHaveBeenCalled();
});
it('honors an access refusal before reservation or transport',async()=>{const f=await state();f.port.active=()=>Promise.reject(Error('FORBIDDEN'));const http=vi.fn(async()=>new Response('{}'));await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',http,candidateExecutionContract);expect(http).not.toHaveBeenCalled();expect(f.state.operation.request_count).toBe(0);});
it('reuses the application short configuration on a 100/68 corpus without changing model, prompt, thresholds or call limits',async()=>{
 const f=await compactComparisonFixture('parallel'),p=f.protocol;await verifyCompactComparison(p.body,p.sha256);
 expect(p.body.source.statistics.scope).toEqual({source_reviews:100,analysed_text_reviews:68,textless_statistics_only:32});
 expect(p.body.review_metadata).toHaveLength(68);expect(p.body.source.source_binding?.dataset_binding.classification_configuration?.id).toBe('jev_categories4_short_common_1pass_v1');
 expect(p.body.ready_template.draft.prompt).toBe(compactSolInstructions('vi'));expect([p.body.max_jev_calls,p.body.max_luna_calls,p.body.max_sol_calls]).toEqual([0,0,1]);
 const bad=structuredClone(f.archive);bad.body.protocol.body.source.source_binding!.dataset_binding.classification_configuration!.sha256='0'.repeat(64);bad.sha256=await directHash(bad.body);
 await expect(prepareCompactComparison(bad,'a'.repeat(40))).rejects.toThrow('COMPACT_REUSED_SCOPE_CHANGED');
});
