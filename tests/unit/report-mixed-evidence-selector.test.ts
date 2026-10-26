// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {evidenceSelectorBinding,verifyEvidenceSelector,requestEvidenceSelector,MIXED_SELECTOR_VERSION,PRIORITY_SELECTOR_VERSION,MIXED_TESTED_SELECTOR_SOURCE_SHA256} from '../../supabase/functions/_shared/report-evidence-selector';
import {MIXED_SOURCE_COMPLETION_POLICY as production} from '../../supabase/functions/_shared/jev-mixed-priority-evidence-selection';
import {MIXED_SOURCE_COMPLETION_POLICY as candidate} from '../../experiments/evidence-priority/mixed-source-completion-proposal';
import {currentReportProtocol} from '../../supabase/functions/_shared/current-report-v2';
import {currentBatchManifest} from '../../supabase/functions/_shared/current-batch-report';
import {processBatchExperiment} from '../../supabase/functions/_shared/jev-batch-experiment';
import {BatchMemory,syntheticCurrentBatchJob,mockBatchJevResponse,mockBatchSolResponse} from '../../supabase/functions/_shared/current-batch-probe';
import {directHash} from '../../supabase/functions/_shared/jev-direct-categories';
import {rehearseParallel} from '../../supabase/functions/_shared/parallel-report-probe';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const keys={jev:'EXPLICIT_MOCK',sol:'EXPLICIT_MOCK'};
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');})));
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});
async function fixture(){
 const binding=await evidenceSelectorBinding(MIXED_SELECTOR_VERSION),job={...syntheticCurrentBatchJob(5),evidence_selector_version:binding.version,evidence_selector_sha256:binding.sha256};
 const p=await currentReportProtocol(job),manifest=await currentBatchManifest(p,s=>s.length),m=new BatchMemory(manifest),calls={jev:0,sol:0};
 const http:typeof fetch=async(url,o)=>{
  if(String(url).includes('typesafe.ai')){calls.jev++;return new Response(JSON.stringify(mockBatchJevResponse(JSON.parse(String(o?.body)))));}
  calls.sol++;return new Response(JSON.stringify({model:'gpt-6.1-sol',status:'completed',usage:{input_tokens:10,output_tokens:20},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(mockBatchSolResponse(m.run.envelope!))}]}]}));
 };
 const step=()=>processBatchExperiment(m.port,m.run.id,keys,http);
 return {binding,job,p,manifest,m,calls,http,step};
}
it('promotes the byte-identical tested function and changes only the production policy label',()=>{
 const audited=readFileSync('experiments/evidence-priority/mixed-source-completion-proposal.ts','utf8').replaceAll('\r\n','\n');
 const shipped=readFileSync('supabase/functions/_shared/jev-mixed-priority-evidence-selection.ts','utf8').replaceAll('\r\n','\n');
 expect(hash(audited)).toBe(MIXED_TESTED_SELECTOR_SOURCE_SHA256);
 const body=(s:string)=>s.slice(s.indexOf('export function selectMixedSourceCompletePriorityEvidence'));
 expect(body(shipped)).toBe(body(audited));expect(hash(body(shipped))).toBe('e995f023d1e6d9d2b1537a1df1d3ae7a83a75afc56941662f112ba9a005ac44f');
 expect({...production,version:candidate.version}).toEqual(candidate);
});
it('has a distinct production binding and refuses the unregistered experimental name and inconsistent hashes',async()=>{
 const b=await evidenceSelectorBinding(MIXED_SELECTOR_VERSION);
 expect(b).toEqual({version:'sol-evidence-started-source-mixed-completion-v1',sha256:'ed41510685e7897f0f0252fee2a9323140dc49e630d7524a51e706b35d09f1b5'});
 await expect(evidenceSelectorBinding(candidate.version)).rejects.toThrow('REPORT_EVIDENCE_SELECTOR_VERSION_INVALID');
 await expect(verifyEvidenceSelector({...b,sha256:'0'.repeat(64)})).rejects.toThrow('REPORT_EVIDENCE_SELECTOR_CHANGED');
 await expect(requestEvidenceSelector(b.version,undefined)).rejects.toThrow('REPORT_EVIDENCE_SELECTOR_CHANGED');
 await expect(requestEvidenceSelector(b.version,candidate.version)).rejects.toThrow('REPORT_EVIDENCE_SELECTOR_CHANGED');
 expect(await requestEvidenceSelector(b.version,b.sha256)).toEqual(b);
 expect((await requestEvidenceSelector(PRIORITY_SELECTOR_VERSION,undefined)).version).toBe(PRIORITY_SELECTOR_VERSION);
});
it.each(['fr','vi'] as const)('pins version/hash through the real protocol and manifest, with unchanged prompts, corpus, JEV plans and statistics: %s',async language=>{
 const f=await fixture();f.job.language=language;
 const p=await currentReportProtocol(f.job),old=await currentReportProtocol({...f.job,evidence_selector_version:PRIORITY_SELECTOR_VERSION,evidence_selector_sha256:(await evidenceSelectorBinding(PRIORITY_SELECTOR_VERSION)).sha256});
 const a=await currentBatchManifest(old,s=>s.length),b=await currentBatchManifest(p,s=>s.length);
 expect(p.body.configuration.evidence_selector).toEqual(f.binding);expect(b.body.configuration.selector).toEqual(f.binding);expect(b.body.template.evidence_selector).toEqual(f.binding);
 expect(p.body.source_snapshot).toEqual(old.body.source_snapshot);expect(p.body.pending).toEqual(old.body.pending);
 expect(b.body.plans).toEqual(a.body.plans);expect(b.body.template.request_json).toBe(a.body.template.request_json);expect(b.body.template.statistics).toEqual(a.body.template.statistics);
 await expect(currentReportProtocol({...f.job,evidence_selector_sha256:'0'.repeat(64)})).rejects.toThrow('REPORT_EVIDENCE_SELECTOR_CHANGED');
});
it('keeps the frozen mixed selector during resume and rollback of future requests',async()=>{
 const f=await fixture();while(f.m.run.stage!=='measure_sol')await f.step();
 const draft=structuredClone(f.m.run.draft),receipts=structuredClone(f.m.tasks.map(t=>t.receipt));
 const prior=await evidenceSelectorBinding(PRIORITY_SELECTOR_VERSION);f.job.evidence_selector_version=prior.version;f.job.evidence_selector_sha256=prior.sha256;
 expect((await currentReportProtocol(f.job)).body.configuration.evidence_selector).toEqual(prior);
 while(f.m.run.armed)await f.step();await f.step();
 expect(f.m.run.draft).toEqual(draft);expect(f.m.tasks.map(t=>t.receipt)).toEqual(receipts);
 expect(f.m.run.envelope!.evidence_selector).toEqual(f.binding);expect(f.m.run.envelope!.selection.version).toBe(MIXED_SELECTOR_VERSION);
 expect(f.m.published?.controls).toMatchObject({evidence_selector:f.binding});
 expect(f.calls).toEqual({jev:1,sol:1});expect(f.m.run.status).toBe('completed');expect(f.m.run.sol_request_count).toBe(1);
});
it.each(['unknown','changed_hash'])('rejects %s before reserving or sending any JEV attempt',async invalid=>{
 const f=await fixture();f.m.run.template.evidence_selector=invalid==='unknown'?{version:'unknown',sha256:'0'.repeat(64)}:{...f.binding,sha256:'0'.repeat(64)};
 const claim=vi.spyOn(f.m.port,'claim');await expect(f.step()).rejects.toThrow(invalid==='unknown'?'REPORT_EVIDENCE_SELECTOR_VERSION_INVALID':'REPORT_EVIDENCE_SELECTOR_CHANGED');
 expect(claim).not.toHaveBeenCalled();expect(f.calls).toEqual({jev:0,sol:0});expect(f.m.tasks.every(t=>t.request_count===0)).toBe(true);
});
it('rejects a rehashed draft version switch before Sol while preserving consumed JEV receipts',async()=>{
 const f=await fixture();while(f.m.run.stage!=='measure_sol')await f.step();const tasks=structuredClone(f.m.tasks);
 f.m.run.draft!.evidence_selector=await evidenceSelectorBinding(PRIORITY_SELECTOR_VERSION);f.m.run.draft_sha256=await directHash(f.m.run.draft);
 await expect(f.step()).rejects.toThrow('BATCH_EVIDENCE_SELECTOR_CHANGED');expect(f.calls).toEqual({jev:1,sol:0});expect(f.m.tasks).toEqual(tasks);
});
it('retains an unknown consumed JEV attempt without sending it again or reaching Sol',async()=>{
 const f=await fixture();let simulated=0;
 const http:typeof fetch=async()=>{simulated++;throw Error('EXPLICIT_SIMULATED_TRANSPORT_UNKNOWN');};
 await processBatchExperiment(f.m.port,f.m.run.id,keys,http);const tasks=structuredClone(f.m.tasks);
 await processBatchExperiment(f.m.port,f.m.run.id,keys,http);
 expect(simulated).toBe(1);expect(f.m.tasks).toEqual(tasks);expect(f.m.run.sol_request_count).toBe(0);
});
it('supports the same production binding in the retained individual route using simulated suppliers only',async()=>{
 const binding=await evidenceSelectorBinding(MIXED_SELECTOR_VERSION),job={...syntheticCurrentBatchJob(3),jev_transport:'individual' as const,evidence_selector_version:binding.version,evidence_selector_sha256:binding.sha256};
 const p=await currentReportProtocol(job),result=await rehearseParallel({...p,id:crypto.randomUUID()});
 expect(result.status).toBe('completed');expect(result.mock_sol).toBe(1);expect(result.mock_luna).toBe(0);
});
