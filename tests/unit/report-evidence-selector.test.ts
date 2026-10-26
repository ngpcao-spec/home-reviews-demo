// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it,expect,vi,afterEach,beforeEach} from 'vitest';
import {evidenceSelectorBinding,PRIORITY_SELECTOR_VERSION,verifyEvidenceSelector} from '../../supabase/functions/_shared/report-evidence-selector';
import {DIRECT_COVERAGE_VERSION} from '../../supabase/functions/_shared/jev-direct-evidence-selection';
import {currentReportProtocol} from '../../supabase/functions/_shared/current-report-v2';
import {currentBatchManifest} from '../../supabase/functions/_shared/current-batch-report';
import {processBatchExperiment} from '../../supabase/functions/_shared/jev-batch-experiment';
import {BatchMemory,syntheticCurrentBatchJob,mockBatchJevResponse,mockBatchSolResponse} from '../../supabase/functions/_shared/current-batch-probe';
import {directHash} from '../../supabase/functions/_shared/jev-direct-categories';
import {rehearseParallel} from '../../supabase/functions/_shared/parallel-report-probe';

beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');})));
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});
const keys={jev:'EXPLICIT_MOCK',sol:'EXPLICIT_MOCK'};
async function fixture(version:string=PRIORITY_SELECTOR_VERSION){
 const job={...syntheticCurrentBatchJob(5),evidence_selector_version:version},p=await currentReportProtocol(job);
 const manifest=await currentBatchManifest(p,s=>s.length),m=new BatchMemory(manifest),calls={jev:0,sol:0};
 const http:typeof fetch=async(url,o)=>{
  if(String(url).includes('typesafe.ai')){calls.jev++;return new Response(JSON.stringify(mockBatchJevResponse(JSON.parse(String(o?.body)))));}
  calls.sol++;return new Response(JSON.stringify({model:'gpt-6.1-sol',status:'completed',usage:{input_tokens:10,output_tokens:20},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(mockBatchSolResponse(m.run.envelope!))}]}]}));
 };
 const step=()=>processBatchExperiment(m.port,m.run.id,keys,http);
 return {job,p,manifest,m,calls,step,http};
}
it('keeps the tested function byte-identical after normalizing checkout line endings, with no new selection variant',()=>{
 const tested=JSON.parse(readFileSync('tests/fixtures/sol-priority-frozen-manifest.json','utf8'));
 const code=readFileSync('supabase/functions/_shared/jev-priority-evidence-selection.ts','utf8').replaceAll('\r\n','\n');
 expect(createHash('sha256').update(code.slice(code.indexOf('export function selectSourceCompletePriorityEvidence'))).digest('hex')).toBe(tested.selector_function_sha256);
});
it('has only two immutable bindings, defaults unversioned work to the old selector, and rejects changed hashes',async()=>{
 expect(await evidenceSelectorBinding()).toEqual({version:DIRECT_COVERAGE_VERSION,sha256:'17ea400f28bdc39c7218e2d62c9d9452d137b8e0b4e4891acfacfa8e0237de5e'});
 const b=await evidenceSelectorBinding(PRIORITY_SELECTOR_VERSION);
 expect(b.sha256).toBe('3ca3d6002e5cb3a1d29221f6b392bed79514b18af5c29eae7861ab90ed2ce973');
 await expect(verifyEvidenceSelector({...b,sha256:'0'.repeat(64)})).rejects.toThrow('REPORT_EVIDENCE_SELECTOR_CHANGED');
 await expect(evidenceSelectorBinding('unrecognized')).rejects.toThrow('REPORT_EVIDENCE_SELECTOR_VERSION_INVALID');
});
it.each(['fr','vi'] as const)('pins the request choice through the protocol and batch template without changing JEV, Sol or statistics: %s',async language=>{
 const job=syntheticCurrentBatchJob(3);job.language=language;
 const old=await currentReportProtocol(job),p=await currentReportProtocol({...job,evidence_selector_version:PRIORITY_SELECTOR_VERSION});
 const a=await currentBatchManifest(old,s=>s.length),b=await currentBatchManifest(p,s=>s.length);
 expect(p.body.pending).toEqual(old.body.pending);expect(p.body.source_snapshot).toEqual(old.body.source_snapshot);
 expect(b.body.configuration.selector).toEqual(p.body.configuration.evidence_selector);
 expect(b.body.template.evidence_selector).toEqual(p.body.configuration.evidence_selector);
 expect(a.body.template).not.toHaveProperty('evidence_selector');
 expect(b.body.template.request_json).toBe(a.body.template.request_json);expect(b.body.template.statistics).toEqual(a.body.template.statistics);
 expect(b.body.plans).toEqual(a.body.plans);expect(await currentBatchManifest(p,s=>s.length)).toEqual(b);
});
it('resumes the saved priority dossier with the same choice after a future request chooses the old selector',async()=>{
 const f=await fixture();while(f.m.run.stage!=='measure_sol')await f.step();
 const saved=structuredClone(f.m.run.draft),receipts=structuredClone(f.m.tasks.map(t=>t.receipt));
 f.job.evidence_selector_version=DIRECT_COVERAGE_VERSION; // Represents a future setting, not this run's frozen template.
 while(f.m.run.armed)await f.step();await f.step();
 expect(f.m.run.draft).toEqual(saved);expect(f.m.tasks.map(t=>t.receipt)).toEqual(receipts);
 expect(f.m.run.envelope!.evidence_selector?.version).toBe(PRIORITY_SELECTOR_VERSION);
 expect(f.calls).toEqual({jev:1,sol:1});expect(f.m.run.sol_request_count).toBe(1);expect(f.m.run.status).toBe('completed');
});
it('keeps a legacy template without a selector field on legacy selection during a resumed run',async()=>{
 const f=await fixture(DIRECT_COVERAGE_VERSION);while(f.m.run.armed)await f.step();
 expect(f.m.run.template).not.toHaveProperty('evidence_selector');expect(f.m.run.draft).not.toHaveProperty('evidence_selector');
 expect(f.m.run.draft!.selection.version).toBe(DIRECT_COVERAGE_VERSION);expect(f.calls).toEqual({jev:1,sol:1});
});
it('blocks a rehashed switch of a saved selection before Sol and preserves consumed receipts',async()=>{
 const f=await fixture();while(f.m.run.stage!=='measure_sol')await f.step();const receipts=structuredClone(f.m.tasks);
 f.m.run.draft!.selection.version=DIRECT_COVERAGE_VERSION;f.m.run.draft_sha256=await directHash(f.m.run.draft);
 await expect(f.step()).rejects.toThrow('BATCH_EVIDENCE_SELECTOR_CHANGED');expect(f.calls).toEqual({jev:1,sol:0});
 expect(f.m.tasks).toEqual(receipts);expect(f.m.run.sol_request_count).toBe(0);
});
it('also keeps the pinned selector through the retained individual route, with explicit simulated responses only',async()=>{
 const job={...syntheticCurrentBatchJob(3),jev_transport:'individual' as const,evidence_selector_version:PRIORITY_SELECTOR_VERSION};
 const p=await currentReportProtocol(job),result=await rehearseParallel({...p,id:crypto.randomUUID()});
 expect(result.status).toBe('completed');expect(result.mock_sol).toBe(1);expect(result.mock_luna).toBe(0);
});
