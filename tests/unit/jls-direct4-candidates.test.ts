import {beforeAll,it,expect,vi} from 'vitest';
import {prepareCandidateOnly,verifyCandidateProtocol,candidateReadyContract,candidateMockResponse,type CandidateInput,type CandidateProtocol} from '../../supabase/functions/_shared/jls-direct4-candidates';
import {DIRECT_CANDIDATE_EMPTY,validateDirectReportEvidence} from '../../supabase/functions/_shared/jev-direct-report-preparation';
import {prepareHistoricalDirect4} from '../../supabase/functions/_shared/jls-direct4-historical';
import {rehearseHistoricalDirect4} from '../../supabase/functions/_shared/jls-direct4-historical-probe';
import {SHORT_FROZEN_DIRECT4} from '../../supabase/functions/_shared/jev-direct-short-config';
import {historicalSnapshotFingerprint,type FrozenHistorical} from '../../supabase/functions/_shared/jls-snapshot-v2';
import {directHash,directCanonical,DIRECT_CATEGORY_KEYS} from '../../supabase/functions/_shared/jev-direct-categories';
import {snapshotReadyMock} from '../../supabase/functions/_shared/jls-snapshot-v2-probe';
import {processReadySol,type ReadyState} from '../../supabase/functions/_shared/jls-sol-ready-worker';
let input:CandidateInput,p:CandidateProtocol;
beforeAll(async()=>{
 const texts=['The soup tasted delicious.','The waiter helped us quickly.','The bill had an unexpected charge.','The room was quiet and comfortable.','Coffee was good but arrived late.'];
 const h={id:crypto.randomUUID(),generation_id:crypto.randomUUID(),organization_id:crypto.randomUUID(),establishment_id:crypto.randomUUID(),requested_by:crypto.randomUUID(),status:'completed',language:'vi',created_at:'2026-10-20T00:00:00Z',
  snapshot:{analysis_version:7,base:{google_total_reviews:200,google_rating:4.5},publication:{},reviews:Array.from({length:135},(_,n)=>({id:crypto.randomUUID(),rating:n%5+1,
   original_text:n<75?texts[n%5]+' '+Array.from({length:8},()=>crypto.randomUUID()).join(' '):'',analysis_text:'',original_language:'en',analysis_language:n<75?'en':null,analysis_source:'original_en',published_at:null,review_context:null,review_detailed_rating:null}))}} as FrozenHistorical;
 h.snapshot.reviews.forEach(r=>{r.analysis_text=r.original_text;});
 h.snapshot.base.source_fingerprint=await historicalSnapshotFingerprint(h.snapshot);
 const pub={id:crypto.randomUUID(),generation_id:h.generation_id},q=await prepareHistoricalDirect4({historical:h,published_report:pub,published_report_canonical:directCanonical(pub),record_sha256:await directHash(h),existing_direct_cache_rows:0,existing_direct4_protocols:0},'a'.repeat(40),SHORT_FROZEN_DIRECT4);
 const replay=await rehearseHistoricalDirect4({...q,id:crypto.randomUUID()});
 const state=replay.fixtures.luna.state,b=state.artifacts.find(a=>a.kind==='direct4_evidence_bundle')!.body as unknown as {dataset:CandidateInput['dataset'];preparation:{body:{statistics:CandidateInput['statistics'];statistics_sha256:string;selection:{selected:CandidateInput['selected']};synthesis:{originals:CandidateInput['originals'];version:string}}}};
 input={reference_archive:{id:crypto.randomUUID(),sha256:'b'.repeat(64)},source_run_id:crypto.randomUUID(),source_protocol_id:b.dataset.protocol_id,source_protocol_sha256:q.sha256,
  organization_id:h.organization_id,establishment_id:h.establishment_id,authority_user_id:h.requested_by,bundle_sha256:'c'.repeat(64),dataset:b.dataset,sources:q.body.source_snapshot.reviews,
  statistics:b.preparation.body.statistics,statistics_sha256:b.preparation.body.statistics_sha256,selected:b.preparation.body.selection.selected,originals:b.preparation.body.synthesis.originals,synthesis:b.preparation.body.synthesis.version};
 p=await prepareCandidateOnly(input,'a'.repeat(40));
},30000);
function state():ReadyState{
 const a=p.body.ready_template,run='EXPLICIT_MOCK_RUN';
 return {protocol:{id:'EXPLICIT_MOCK_PROTOCOL',...structuredClone(p)},ready:{body:{version:'jls-direct4-sol-ready-v1',source_protocol_id:'EXPLICIT_MOCK_PROTOCOL',source_protocol_sha256:p.sha256,source_run_id:run,candidate_template:a,
  sol:{gate:{passed:true,scope:'technical_candidate_sources_not_semantic_acceptance'},draft:a.draft},request_json:a.request_json,request_sha256:a.request_sha256,request_raw_sha256:a.request_raw_sha256,measurement:a.measurement,token_certificate:a.token_certificate,token_certificate_sha256:a.token_certificate_sha256},sha256:''},
  operation:{id:'EXPLICIT_MOCK_OPERATION',organization_id:p.body.organization_id,mode:'mock',run_id:run,status:'queued',phase:'sol',request_count:0,worker:null,receipt:null,receipt_sha256:null,result:null}} as unknown as ReadyState;
}
async function fixture(){const s=state();s.ready.sha256=await directHash(s.ready.body);return snapshotReadyMock(s);}
it('keeps the same 32 candidates and statistics, with zero JEV/Luna/Apify and no authorization at preparation',async()=>{
 expect(p.body.source.selected).toEqual(input.selected);expect(p.body.source.statistics).toEqual(input.statistics);
 expect(p.body.ready_template.draft.packet.evidence).toHaveLength(32);expect(p.body.max_jev_calls).toBe(0);expect(p.body.max_luna_calls).toBe(0);expect(p.body.max_apify_calls).toBe(0);
 expect(p.body.spending_authorization).toBeNull();expect(p.body.run_id).toBeNull();
 await expect(verifyCandidateProtocol(p.body,p.sha256)).resolves.toBeUndefined();
});
it('sends neither verdicts nor previous report; includes full quotation context and original texts',()=>{
 const packet=p.body.ready_template.draft.packet;
 expect(packet.scope).toBe('UNVERIFIED_CUSTOMER_CANDIDATES_SOL_SELF_REVIEW');
 expect(packet).not.toHaveProperty('luna_results');expect(packet).not.toHaveProperty('previous_report');
 expect(p.body.ready_template.draft.prompt).not.toContain('Luna');
 for(const e of packet.evidence){expect(e).not.toHaveProperty('status');expect(e).not.toHaveProperty('confidence');expect(e).not.toHaveProperty('probabilities');
  const source=input.selected.find(s=>s.evidence_id===e.evidence_id)!;expect(e.quote).toBe(source.quote);
  expect(e.context_same_as_quote?e.quote:e.context).toBe(source.context);
  expect(packet.original_reviews.some(r=>r.review_id===e.review_id)).toBe(true);}
 expect(p.body.ready_template.measurement.input_budget_tokens).toBe(32768);expect(p.body.ready_template.measurement.guarded_input_tokens).toBeLessThanOrEqual(32768);
});
it('allows Sol to omit unfounded associations and return fewer than three recommendations',async()=>{
 const raw=JSON.parse(candidateMockResponse(p.body).output[0].content[0].text);
 raw.report.categories[0]={category:'service',text:DIRECT_CANDIDATE_EMPTY,evidence_ids:[]};
 await expect(validateDirectReportEvidence(raw,p.body.source.statistics_sha256,p.body.source.selected,true)).resolves.toBeTruthy();
 raw.report.categories=DIRECT_CATEGORY_KEYS.map(category=>({category,text:DIRECT_CANDIDATE_EMPTY,evidence_ids:[]}));
 raw.report.conclusion={text:DIRECT_CANDIDATE_EMPTY,evidence_ids:[]};
 await expect(validateDirectReportEvidence(raw,p.body.source.statistics_sha256,p.body.source.selected,true)).resolves.toBeTruthy();
});
it.each(['id','category','quote','hash','statistics'])('rejects a changed %s without loosening technical checks',async kind=>{
 const raw=JSON.parse(candidateMockResponse(p.body).output[0].content[0].text),e=p.body.source.selected[0];
 raw.report.recommendations=[{title:'SYNTHETIC',category:e.category,evidence_ids:[e.evidence_id],observations:[{text:'SYNTHETIC',evidence_id:e.evidence_id,quote:e.quote,quote_sha256:e.quote_sha256}],proposed_action:'SYNTHETIC PROPOSAL',priority_reason:'SYNTHETIC'}];
 if(kind==='id')raw.report.recommendations[0].evidence_ids=['invented'];if(kind==='category')raw.report.recommendations[0].category=DIRECT_CATEGORY_KEYS.find(k=>k!==e.category)!;
 if(kind==='quote')raw.report.recommendations[0].observations[0].quote+='invented';if(kind==='hash')raw.report.recommendations[0].observations[0].quote_sha256='0'.repeat(64);if(kind==='statistics')raw.statistics_sha256='0'.repeat(64);
 await expect(validateDirectReportEvidence(raw,p.body.source.statistics_sha256,p.body.source.selected,true)).rejects.toThrow();
});
it('rejects a changed frozen source even with a newly calculated outer hash',async()=>{
 const b=structuredClone(p.body);b.source.selected[0].context+='changed';b.source_sha256=await directHash(b.source);
 await expect(verifyCandidateProtocol(b,await directHash(b))).rejects.toThrow();
});
it('reuses atomic one-call receipt/validation workers under concurrent and repeated wakes',async()=>{
 const f=await fixture(),http=vi.fn(async()=>new Response(JSON.stringify(candidateMockResponse(p.body))));
 await Promise.all(Array.from({length:8},()=>processReadySol(f.port,f.state.operation.id,'MOCK_ONLY',http,candidateReadyContract)));
 expect(http).toHaveBeenCalledTimes(1);expect(f.state.operation.receipt).toBeTruthy();expect(f.state.operation.result).toBeNull();
 await processReadySol(f.port,f.state.operation.id,'MOCK_ONLY',http,candidateReadyContract);
 expect(f.state.operation.status).toBe('completed');expect(f.state.operation.result?.validated_report).toBeTruthy();
 await processReadySol(f.port,f.state.operation.id,'MOCK_ONLY',http,candidateReadyContract);expect(http).toHaveBeenCalledTimes(1);
});
it.each(['timeout','invalid','missing_usage','wrong_model'])('retains %s without a second paid attempt',async kind=>{
 const f=await fixture(),http=vi.fn(async()=>{if(kind==='timeout')throw Error('TIMEOUT');const r=candidateMockResponse(p.body);
  if(kind==='missing_usage')delete (r as {usage?:unknown}).usage;if(kind==='wrong_model')r.model='wrong';return new Response(kind==='invalid'?'{invalid':JSON.stringify(r));});
 await processReadySol(f.port,f.state.operation.id,'MOCK_ONLY',http,candidateReadyContract);
 await processReadySol(f.port,f.state.operation.id,'MOCK_ONLY',http,candidateReadyContract);
 await processReadySol(f.port,f.state.operation.id,'MOCK_ONLY',http,candidateReadyContract);
 expect(http).toHaveBeenCalledTimes(1);expect(f.state.operation.receipt).toBeTruthy();expect(f.state.operation.status).not.toBe('completed');
});
