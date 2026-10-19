import {it,expect,vi,beforeAll,afterAll} from 'vitest';
import {syntheticChill80} from '../fixtures/chill80-synthetic';
import {prioritizedFixture} from '../fixtures/jev-luna-sol-prioritized';
import {prepareChill80,parseChill80,chill80Counts,type Chill80Analysis} from '../../supabase/functions/_shared/jev-chill-reanalysis80';
import {CORRECTED_DATASET_ID,CORRECTED_REPORT_POLICY,verifyCorrectedReportInput,compatibleCorrectedVerdict,type CorrectedReportInput} from '../../supabase/functions/_shared/jls-corrected80-preparation';
import {hybridHash} from '../../supabase/functions/_shared/jev-hybrid-evidence';
import {syntheticJev} from '../fixtures/chill80-synthetic';
import type {PilotSnapshot} from '../../supabase/functions/_shared/jev-pilot-core';
let blocked:ReturnType<typeof vi.spyOn>;
beforeAll(()=>{blocked=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('PROVIDER_NETWORK_FORBIDDEN'));});
afterAll(()=>{expect(blocked).not.toHaveBeenCalled();blocked.mockRestore();});
async function input(){
 const source=await prepareChill80(await syntheticChill80()),analyses:Chill80Analysis[]=[...source.body.reused];
 for(const r of source.body.pending)analyses.push({...await parseChill80(source,r.review_id,syntheticJev()),duration_ms:1,
  provenance:{kind:'new_execution',result_id:r.review_id,receipt_id:'EXPLICIT_MOCK',result_sha256:'0'.repeat(64),receipt_sha256:'0'.repeat(64)}});
 const body={version:'jev-chill-reanalysis80-dataset-v1',protocol_sha256:source.sha256,analyses,
  counts:{native:chill80Counts(analyses,'native'),thresholded:chill80Counts(analyses,'thresholded')},
  textless_review_ids:source.body.reviews.filter(r=>!r.analysis_text).map(r=>r.id),denominators:{all_reviews:100,with_text:80,analysed:80,without_text:20}};
 const snapshot={organization_id:source.body.organization_id,establishment_id:source.body.establishment_id,source:{reviews:source.body.reviews}} as PilotSnapshot;
 return {source:{...source,id:'EXPLICIT_MOCK_PROTOCOL'},dataset:{id:CORRECTED_DATASET_ID,body,sha256:await hybridHash(body)},snapshot,prior:[],code_provenance:'a'.repeat(40)} satisfies CorrectedReportInput;
}
it('validates 80 corrected results, all 25 themes, immutable counts and the 20 textless sources without suppliers',async()=>{
 const i=await input(),before=await hybridHash(i);await verifyCorrectedReportInput(i);expect(await hybridHash(i)).toBe(before);
 expect(CORRECTED_REPORT_POLICY).toMatchObject({max_jev_calls:0,max_luna_calls:32,max_sol_calls:1,max_apify_calls:0,automatic_retry:false,client_max_attempts:1});
});
it.each(['dataset','count','duplicate','configuration','model','threshold','textless','organization','text'] as const)('rejects modified %s without changing thresholds or calling a provider',async kind=>{
 const i=await input();
 if(kind==='dataset')i.dataset.id='other';if(kind==='count')i.dataset.body.counts.thresholded.portions.negative_review_count++;
 if(kind==='duplicate')i.dataset.body.analyses[1]=i.dataset.body.analyses[0];if(kind==='configuration')i.dataset.body.analyses[0].configuration_id='v12_economy_1pass_v1';
 if(kind==='model')i.dataset.body.analyses[0].served_model='new-model';if(kind==='threshold')i.dataset.body.analyses[0].theme_results.portions.choice='negative';
 if(kind==='textless')i.dataset.body.textless_review_ids.pop();if(kind==='organization')i.snapshot.organization_id='another';
 if(kind==='text')i.snapshot.source.reviews[0].analysis_text+=' modified';
 i.dataset.sha256=await hybridHash(i.dataset.body);await expect(verifyCorrectedReportInput(i)).rejects.toThrow();
});
let old:ReturnType<typeof prioritizedFixture>;
const original=()=>old??=prioritizedFixture('vi');
async function reuseInput(){const f=await original(),body={plan:f.p,decisions:f.decisions};
 return {f,i:{snapshot:f.snapshot,prior:[{id:'EXPLICIT_HISTORICAL_MOCK',sha256:await hybridHash(body),...body}]} as CorrectedReportInput};}
it('reuses an unchanged question independently of changed JEV configuration/statistics, keeping the original verdict',async()=>{
 const {f,i}=await reuseInput(),e=structuredClone(f.p.selected.find(e=>e.theme_key==='cooking')!);
 const originalSha=await hybridHash(f.decisions);e.configuration_jev='v12_economy_audit_boundaries_v2_1pass_v1';
 const found=await compatibleCorrectedVerdict(e,i);expect(found).not.toBeNull();expect(found!.decision).toEqual(f.decisions.find(d=>d.evidence_id===e.evidence_id));
 expect(await hybridHash(f.decisions)).toBe(originalSha);
});
it.each(['quote','context','theme','polarity','text','question'] as const)('does not transfer a verdict after changed %s',async kind=>{
 const {f,i}=await reuseInput(),copy=structuredClone(i),e=structuredClone(f.p.selected.find(e=>e.theme_key==='cooking')!);
 if(kind==='quote')e.quote+=' changed';if(kind==='context')e.context+=' changed';if(kind==='theme')e.theme_key='food_quality';
 if(kind==='polarity')e.polarity='positive';if(kind==='text')e.analysis_text_sha256='0'.repeat(64);
 if(kind==='question'){const g=copy.prior[0].plan.luna_groups.find(g=>g.evidence_ids.includes(e.evidence_id))!;g.payload.questions[0].instructions+=' changed';}
 expect(await compatibleCorrectedVerdict(e,copy)).toBeNull();
});
