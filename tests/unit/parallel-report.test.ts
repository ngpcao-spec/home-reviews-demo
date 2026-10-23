import {it,expect,vi} from 'vitest';
import {parallelProtocol,verifyParallelProtocol,deriveReferenceLinks,validateParallelReport,parallelExecutionContract,PARALLEL_REPORT,parallelSolEnvelope,measureParallelSolEnvelope} from '../../supabase/functions/_shared/parallel-report';
import {directCanonical} from '../../supabase/functions/_shared/jev-direct-categories';
import {shortJev} from '../../supabase/functions/_shared/direct4-short-comparison';
import {directHash} from '../../supabase/functions/_shared/jev-direct-categories';
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text';
import {rehearseParallel} from '../../supabase/functions/_shared/parallel-report-probe';
import {restaurantAttempt,type RestaurantState,type RestaurantTask} from '../../supabase/functions/_shared/jls-restaurant-worker';
import type {DirectReportEvidence} from '../../supabase/functions/_shared/jev-direct-report-preparation';
const id=()=>crypto.randomUUID();
async function fixture(){const org=id(),est=id(),gen=id(),report={id:id(),organization_id:org,establishment_id:est,generation_id:gen,preferred_language:'vi',stored_reviews_count:7,source_fingerprint:'fixed'};
 const history={id:id(),organization_id:org,establishment_id:est,generation_id:gen,status:'completed',snapshot:{base:{source_fingerprint:'fixed'},reviews:Array.from({length:7},(_,n)=>({id:id(),rating:n%5+1,original_text:n===6?'':'SYNTHETIC distinct review '+n+' with enough context about food and staff, beautiful room and affordable prices.',analysis_text:n===6?'':'SYNTHETIC distinct review '+n+' with enough context about food and staff, beautiful room and affordable prices.',analysis_source:'original_en',analysis_language:n===6?null:'en',original_language:'en',review_detailed_rating:null,review_context:null,published_at:null}))}};
 return {report,history,p:await parallelProtocol(report,history,id(),'a'.repeat(40))};}
it('freezes the selected corpus and uses exactly the archived short prompt; textless reviews have no JEV task',async()=>{const {p}=await fixture();await verifyParallelProtocol(p.body,p.sha256);expect(p.body.denominators).toEqual({source_reviews:7,analytical_reviews:6,textless_statistics_only:1});expect(p.body.max_luna_calls).toBe(0);expect(p.body.max_sol_calls).toBe(1);for(const t of p.body.pending)expect(t.payload).toEqual(shortJev({review_alias:'review_'+t.review_id,analysis_text:t.payload.state.analysis_text}));});
it.each(['establishment_id','organization_id','generation_id'])('refuses a different %s',async key=>{const {report,history}=await fixture();await expect(parallelProtocol(report,{...history,[key]:id()},id(),'a'.repeat(40))).rejects.toThrow('PARALLEL_CORPUS_UNAVAILABLE');});
it('blocks missing corpus without import or automatic replacement generation',async()=>{const {report,history}=await fixture();history.snapshot.reviews=[];await expect(parallelProtocol(report,history,id(),'a'.repeat(40))).rejects.toThrow();});
it('rejects altered source despite recomputed outer hash',async()=>{const {p}=await fixture();p.body.source_snapshot.reviews[0].analysis_text+=' changed';await expect(verifyParallelProtocol(p.body,await directHash(p.body))).rejects.toThrow();});
it('rehearses the full shared worker path, concurrent Sol wakes, receipt and validation without Luna or native network',async()=>{const deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'));try{const {p}=await fixture(),r=await rehearseParallel({...p,id:id()});expect(r).toMatchObject({provider_calls:0,mock_jev:6,mock_luna:0,mock_sol:1,status:'completed'});expect(r.ready.body.packet).not.toHaveProperty('luna_results');expect(r.ready.body.packet).not.toHaveProperty('previous_report');expect(r.ready.body.compact_wire?.reviews.length).toBeGreaterThan(0);expect(r.request_measurement.guarded_input_tokens).toBeLessThanOrEqual(32768);expect(deny).not.toHaveBeenCalled();}finally{deny.mockRestore();}});
it('retains the exact historical wire and validation path for protocols sealed before compact transport',async()=>{
 const {p}=await fixture();delete (p.body.configuration as {sol_wire_version?:string}).sol_wire_version;p.body.configuration_sha256=await directHash(p.body.configuration);p.sha256=await directHash(p.body);
 const r=await rehearseParallel({...p,id:id()});expect(r.status).toBe('completed');expect(r.ready.body).not.toHaveProperty('compact_wire');expect(r.ready.body.packet).toHaveProperty('original_reviews');
});
it('persists the native compact response separately and reconstructs exact source fields through the shared worker',async()=>{
 const {p}=await fixture(),r=await rehearseParallel({...p,id:id()}),out=r.operation.result!.validated_report as unknown as {compact_response:unknown;source_reconstruction:unknown;report:{recommendations:{observations:{evidence_id:string;quote:string;quote_sha256:string}[]}[]}};
 const o=out.report.recommendations[0].observations[0],e=r.ready.body.evidence.find(e=>e.evidence_id===o.evidence_id)!;
 expect(o.quote).toBe(e.quote);expect(o.quote_sha256).toBe(e.quote_sha256);expect(out.source_reconstruction).toMatchObject({generated_text_changed:false,manifest_sha256:r.ready.body.compact_wire_sha256});
 expect(JSON.stringify(out.compact_response)).not.toContain('quote_sha256');expect(r.operation.request_count).toBe(1);
});
it('persists the free envelope before tokenization without changing any final request bytes or controls',async()=>{
 const {p}=await fixture(),r=await rehearseParallel({...p,id:id()}),envelope=await parallelSolEnvelope(r.state);
 expect(envelope.body).not.toHaveProperty('measurement');expect(envelope.body).not.toHaveProperty('token_certificate');
 const persisted={body:JSON.parse(directCanonical(envelope.body)),sha256:envelope.sha256},ready=await measureParallelSolEnvelope(persisted);
 expect(ready.body.request_json).toBe(r.ready.body.request_json);expect(directCanonical(ready.body)).toBe(directCanonical(r.ready.body));
 persisted.body.request_json+=' ';await expect(measureParallelSolEnvelope(persisted)).rejects.toThrow('PARALLEL_SOL_ENVELOPE_CHANGED');
});
it('uses the sealed server certificate without removing raw-response, source or native-result checks',async()=>{
 const {p}=await fixture(),r=await rehearseParallel({...p,id:id()}),s=r.state,body={version:'parallel-runtime-certificate-v1',protocol_id:s.protocol.id,protocol_sha256:s.protocol.sha256,
  organization_id:p.body.organization_id,establishment_id:p.body.establishment_id,authority_user_id:p.body.authority_user_id,
  source_snapshot_sha256:p.body.source_snapshot_sha256,configuration_sha256:p.body.configuration_sha256,pending_sha256:p.body.pending_sha256};
 const c={...body,body,sha256:await directHash(body)};
 const envelope=await parallelSolEnvelope(s,c);expect(directCanonical(envelope)).toBe(directCanonical(await parallelSolEnvelope(s)));
 await expect(parallelSolEnvelope(s,{...c,organization_id:id()})).rejects.toThrow('PARALLEL_RUNTIME_CERTIFICATE_CHANGED');
 const changed=structuredClone(s),a=changed.artifacts.find(a=>a.kind.startsWith('task:'))!,native=a.body.direct4_result as {categories:{service:{classification:string;native_choice:string}}};
 native.categories.service.classification='negative';native.categories.service.native_choice='negative';a.sha256=await directHash(a.body);
 await expect(parallelSolEnvelope(changed,c)).rejects.toThrow('JEV_DIRECT_RESULT_CHANGED');
});
it.each(['timeout','429','500','invalid'])('keeps one shared supplier attempt on %s, never fallback/retry',async kind=>{const {p}=await fixture(),pending=p.body.pending[0],task={id:id(),run_id:id(),organization_id:p.body.organization_id,phase:'jev',review_id:pending.review_id,request:pending.payload,request_sha256:pending.request_sha256,identity:pending.identity,status:'running',request_count:1} as RestaurantTask;
 const state={protocol:{id:id(),body:p.body,sha256:p.sha256},run:{id:task.run_id},artifacts:[]} as unknown as RestaurantState;
 const http=vi.fn(async()=>{if(kind==='timeout')throw Error('MOCK_TIMEOUT');return new Response(kind==='invalid'?'{bad':'{}',{status:kind==='429'?429:kind==='500'?500:200});});await restaurantAttempt(task,state,'EXPLICIT_MOCK',http,parallelExecutionContract);expect(http).toHaveBeenCalledTimes(1);});
async function links(){const quote='A customer reports changing explanations at the ticket counter. Other staff were helpful.',q=await analysisTextSha256(quote),negative={evidence_id:'negative',review_id:'same-review',category:'service',polarity:'negative',quote,context:quote,quote_sha256:q} as DirectReportEvidence,positive={...negative,evidence_id:'positive',polarity:'positive'} as DirectReportEvidence;
 const raw={format_version:'jls-direct-categories4-report-v1',statistics_sha256:'a'.repeat(64),report:{categories:['service','price','quality','ambiance'].map(category=>({category,text:'Synthetic text',evidence_ids:['negative']})),positive_aspects:[],negative_aspects:[{category:'service',text:'The complaint retains praise for the other staff.',evidence_ids:['negative','positive']}],conclusion:{text:'Synthetic conclusion',evidence_ids:['negative','negative']},recommendations:[{title:'Review the explanations',category:'service',evidence_ids:['negative','positive','negative'],observations:[{text:'The customer reports changing explanations.',evidence_id:'negative',quote,quote_sha256:q}],proposed_action:'Review this case.',priority_reason:'A precise report.'}]}};return {raw,evidence:[negative,positive]};}
it('deduplicates and removes only unobserved links and the redundant wrong polarity with identical same-review text',async()=>{const {raw,evidence}=await links(),before=JSON.stringify(raw),d=deriveReferenceLinks(raw,evidence);expect(JSON.stringify(raw)).toBe(before);expect(d.derived.report.recommendations[0].evidence_ids).toEqual(['negative']);expect(d.derived.report.negative_aspects[0].evidence_ids).toEqual(['negative']);expect(d.derived.report.recommendations[0].observations).toEqual(raw.report.recommendations[0].observations);expect(d.derived.report.negative_aspects[0].text).toBe(raw.report.negative_aspects[0].text);});
it('does not remove a mismatched-polarity source when preserved passage coverage is not established',async()=>{const {raw,evidence}=await links();evidence[1].review_id='different';const d=deriveReferenceLinks(raw,evidence);expect(d.issues).toContainEqual({path:'negative_aspects[0]',reason:'remaining_passage_coverage_not_established'});expect(d.derived.report.negative_aspects[0].evidence_ids).toEqual(['negative','positive']);});
it('does not invent missing observations or alter quotations and still rejects modified statistics',async()=>{const {raw,evidence}=await links();raw.report.recommendations[0].observations[0].quote='invented';expect(deriveReferenceLinks(raw,evidence).issues[0].reason).toBe('observation_coverage_not_established');await expect(validateParallelReport(raw,{evidence,statistics_sha256:'a'.repeat(64)} as never)).rejects.toThrow('DIRECT_REPORT_QUOTE_CHANGED');raw.statistics_sha256='b'.repeat(64);await expect(validateParallelReport(raw,{evidence,statistics_sha256:'a'.repeat(64)} as never)).rejects.toThrow('DIRECT_REPORT_STATISTICS_OR_CATEGORIES_CHANGED');});
it('keeps the new protocol separate from production versions',()=>expect(PARALLEL_REPORT).toBe('jls-direct4-parallel-no-luna-v1'));
it('binds the future selector to the protocol while preserving pre-coverage preparations',async()=>{
 const {p}=await fixture();expect(p.body.configuration.evidence_selector?.version).toBe('jls-direct4-negative-mixed-coverage-v1');
 const hash=p.body.configuration.evidence_selector!.sha256;p.body.configuration.evidence_selector!.sha256='0'.repeat(64);
 p.body.configuration_sha256=await directHash(p.body.configuration);await expect(verifyParallelProtocol(p.body,await directHash(p.body))).rejects.toThrow('PARALLEL_EVIDENCE_SELECTOR_CHANGED');
 p.body.configuration.evidence_selector!.sha256=hash;
 delete p.body.configuration.evidence_selector;p.body.configuration_sha256=await directHash(p.body.configuration);p.sha256=await directHash(p.body);
 const r=await rehearseParallel({...p,id:id()});expect(r.ready.body.selection.algorithm).toBe('existing_selectBalancedEvidence');
 expect(r.ready.body.selection).not.toHaveProperty('coverage_diagnostics');
});
