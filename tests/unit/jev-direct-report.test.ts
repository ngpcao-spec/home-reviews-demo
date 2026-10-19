import {it,expect,beforeAll,afterAll,vi} from 'vitest';
import {DIRECT_CATEGORY_KEYS,DIRECT_CONFIG,directHash,directCategoryCounts,parseDirectCategoriesRounded} from '../../supabase/functions/_shared/jev-direct-categories';
import {directReportCandidates,directReportLunaGroups,directLunaCompatibility,parseDirectReportLuna,directAcceptedSol,validateDirectReport,
 DIRECT_REPORT_FORMAT,DIRECT_REPORT_POLICY,directReportInstructions,verifyDirectReportSources,
 type DirectReportInput,type DirectReportPreparation,type DirectLunaGroup} from '../../supabase/functions/_shared/jev-direct-report-preparation';
import {selectBalancedEvidence} from '../../supabase/functions/_shared/jev-hybrid-balanced';
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text';
import {directMockRaw} from '../fixtures/jev-direct-categories';
let net:ReturnType<typeof vi.spyOn>;
beforeAll(()=>{net=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('ALL_PROVIDER_NETWORK_FORBIDDEN'));});
afterAll(()=>{expect(net).not.toHaveBeenCalled();net.mockRestore();});
async function fixture(){
 const rows=await Promise.all(Array.from({length:80},async(_,n)=>{
  const category=DIRECT_CATEGORY_KEYS[n%4],native=n<8?'negative':n===8?'mixed':n===9?'uncertain':n===10?'neutral':'positive',
   raw=directMockRaw({[category]:native}),result=parseDirectCategoriesRounded(raw),text='EXPLICIT SYNTHETIC '+category+' observation '+n;
  return {review_id:'synthetic_'+n,analysis_text:text,analysis_text_sha256:await analysisTextSha256(text),analysis_language:'en',organization_id:'org',establishment_id:'est',
   result,result_sha256:await directHash(result),raw_response_text:JSON.stringify(raw),response_raw_sha256:await analysisTextSha256(JSON.stringify(raw)),
   translation_source:'original_en',translation_provenance:{synthetic:true},receipt_id:'synthetic_receipt_'+n};
 }));
 const i:DirectReportInput={dataset:{id:'synthetic_dataset',sha256:'0'.repeat(64),protocol_id:'synthetic_protocol',organization_id:'org',body:{version:'synthetic',
  configuration_id:DIRECT_CONFIG.id,configuration_sha256:await directHash(DIRECT_CONFIG),reviews:rows,counts:directCategoryCounts(rows.map(r=>r.review_id),rows)}},
  snapshot:{id:'synthetic_snapshot',sha256:'0'.repeat(64),protocol_id:'synthetic_protocol',organization_id:'org',body:{source_reviews_sha256:'0'.repeat(64),
   reviews:Array.from({length:100},(_,n)=>({id:'synthetic_'+n,rating:n<8?1:5,organization_id:'org',establishment_id:'est',
    original_text:n<80?rows[n].analysis_text:'',original_text_sha256:'0'.repeat(64),analysis_text:n<80?rows[n].analysis_text:null,analysis_text_sha256:n<80?rows[n].analysis_text_sha256:null}))}},prior_luna_requests:[]};
 const all=await directReportCandidates(i),selected=all.filter(e=>Number(e.review_id.slice(10))<16),groups=await directReportLunaGroups(selected);
 const statistics={scope:{source_reviews:100,analysed_text_reviews:80,textless_statistics_only:20},counts:i.dataset.body.counts};
 // Deliberately synthetic in-memory contract, not an archived preparation or a paid authorization.
 const body={version:'EXPLICIT_SYNTHETIC_CONTRACT',selection:{selected},luna_groups:groups,statistics,statistics_sha256:await directHash(statistics)};
 const p={body,sha256:await directHash(body)} as unknown as DirectReportPreparation;
 return {i,all,selected,groups,p};
}
function mock(group:DirectLunaGroup,choice='supported',confidence=1){return {model:'gpt-6-luna',usage:{input_tokens:10,output_tokens:0,total_tokens:10},
 answers:group.evidence_ids.map(name=>({name,type:'choice',choice,confidence,probabilities:['supported','unsupported','uncertain'].map(value=>({value,probability:value===choice?1:0}))}))};}
async function accepted(f:Awaited<ReturnType<typeof fixture>>){return Promise.all(f.groups.map(g=>parseDirectReportLuna(g,mock(g))));}
function report(f:Awaited<ReturnType<typeof fixture>>){return {format_version:DIRECT_REPORT_FORMAT,statistics_sha256:f.p.body.statistics_sha256,
 report:{categories:DIRECT_CATEGORY_KEYS.map(category=>({category,text:'EXPLICIT SYNTHETIC Vietnamese placeholder',evidence_ids:[f.selected.find(e=>e.category===category)!.evidence_id]})),
 positive_aspects:[],negative_aspects:[],conclusion:{text:'EXPLICIT SYNTHETIC conclusion',evidence_ids:[f.selected[0].evidence_id]},recommendations:[] as {title:string;category:string;evidence_ids:string[];
 observations:{text:string;evidence_id:string;quote:string;quote_sha256:string}[];proposed_action:string;priority_reason:string}[]}};}
it('keeps 100/80/20 scope, mixed deduplication, neutrality and uncertainty; never uses the 20 textless reviews as evidence',async()=>{
 const f=await fixture(),c=f.i.dataset.body.counts;
 expect(c.total_reviews).toBe(80);expect(c.categories.service.exclusive.mixed).toBe(1);
 expect(c.categories.service.positive_review_ids.filter(id=>id==='synthetic_8')).toHaveLength(1);
 expect(c.categories.service.negative_review_ids.filter(id=>id==='synthetic_8')).toHaveLength(1);
 expect(c.categories.price.exclusive.uncertain).toBe(1);expect(c.categories.quality.exclusive.neutral).toBe(1);
 expect(f.all.filter(e=>e.review_id==='synthetic_8')).toHaveLength(2);
 expect(f.all.some(e=>['synthetic_9','synthetic_10','synthetic_80'].includes(e.review_id))).toBe(false);
 for(const e of f.all){const r=f.i.dataset.body.reviews.find(r=>r.review_id===e.review_id)!;
  expect(e.quote).toBe(r.analysis_text);expect(e.context).toBe(e.quote);expect(e.quote_sha256).toBe(r.analysis_text_sha256);
  expect(e.jev_native).toEqual(r.result.categories[e.category]);expect(e.status).toBe('luna_pending');}
 expect(DIRECT_REPORT_POLICY).toMatchObject({max_jev_calls:0,max_sol_calls:1,automatic_retry:false,paid_enabled:false,production_enabled:false});
});
it('groups two category/polarity questions into one existing Decisions request with a single text and no stars or historical labels',async()=>{
 const f=await fixture(),g=f.groups.find(g=>g.review_id==='synthetic_8')!;
 expect(g.evidence_ids).toHaveLength(2);expect(g.payload.questions).toHaveLength(2);
 expect(Object.keys(JSON.parse(g.payload.input))).toEqual(['review_alias','analysis_text']);
 for(const q of g.payload.questions){expect(q.type).toBe('choice');if(q.type==='choice')expect(q.choices.map(c=>c.value)).toEqual(['supported','unsupported','uncertain']);
  expect(q.instructions).not.toContain('food_quality');expect(q.instructions).not.toContain('wait_time');}
 expect(f.groups.length).toBe(new Set(f.selected.map(e=>e.review_id)).size);
});
it.each(['unsupported','uncertain','supported_low_confidence','refusal'] as const)('does not pass %s evidence to Sol or force recommendations',async mode=>{
 const f=await fixture(),results=await Promise.all(f.groups.map(g=>{const raw=mock(g,mode==='unsupported'?'unsupported':mode==='uncertain'?'uncertain':'supported',mode==='supported_low_confidence'?.59:1);
  if(mode==='refusal')raw.answers=raw.answers.map(a=>({name:a.name,type:'refusal'} as typeof a));return parseDirectReportLuna(g,raw);}));
 const b=await directAcceptedSol(f.p,results);expect(b.gate.passed).toBe(false);expect(b.accepted).toEqual([]);expect(b.draft).toBeNull();
});
it('uses the existing sufficiency gate and accepts zero recommendations with enough evidence, without inventing a Sol result',async()=>{
 const f=await fixture(),results=await accepted(f),b=await directAcceptedSol(f.p,results);
 expect(b.gate.passed).toBe(true);expect(b.gate.policy.minimum_accepted).toBe(8);
 expect(b.draft!.packet.scope).toBe('LUNA_ACCEPTED_ONLY');expect(b.draft!.packet.statistics).toEqual(f.p.body.statistics);
 expect(b.draft!.measurement.guarded_input_tokens).toBeLessThanOrEqual(32768);
 const out=await validateDirectReport(report(f),f.p,results);expect(out.report.recommendations).toEqual([]);expect(out.human_validated).toBe(false);
 expect(out.semantic_correctness_guaranteed).toBe(false);
});
it('keeps rejected evidence out of Sol without changing category counters',async()=>{
 const f=await fixture(),results=await accepted(f),g=f.groups.at(-1)!;
 results[results.length-1]=await parseDirectReportLuna(g,mock(g,'unsupported'));
 const b=await directAcceptedSol(f.p,results);expect(b.gate.passed).toBe(true);
 expect(b.draft!.packet.evidence.some(e=>g.evidence_ids.includes(e.evidence_id))).toBe(false);expect(b.draft!.packet.statistics).toEqual(f.p.body.statistics);
 const r=report(f);r.report.conclusion.evidence_ids=g.evidence_ids;await expect(validateDirectReport(r,f.p,results)).rejects.toThrow('UNACCEPTED');
});
it.each(['missing_results','duplicate_result','changed_native','changed_request','wrong_model'] as const)('rejects %s without retry or fallback',async kind=>{
 const f=await fixture(),rs=await accepted(f);
 if(kind==='missing_results')rs.pop();if(kind==='duplicate_result')rs[1]=rs[0];
 if(kind==='changed_native')rs[0].decisions[0].status='REJECTED';if(kind==='changed_request')rs[0].request_sha256='0'.repeat(64);
 if(kind==='wrong_model'){const raw=mock(f.groups[0]);raw.model='another-model';await expect(parseDirectReportLuna(f.groups[0],raw)).rejects.toThrow();return;}
 await expect(directAcceptedSol(f.p,rs)).rejects.toThrow();
});
it.each(['invented_quote','wrong_category','wrong_hash','no_observation','foreign_id','changed_counts'] as const)('rejects report %s while preserving a separate proposed action',async kind=>{
 const f=await fixture(),rs=await accepted(f),e=f.selected[0],r=report(f);
 r.report.recommendations=[{title:'EXPLICIT SYNTHETIC title',category:e.category,evidence_ids:[e.evidence_id],
  observations:[{text:'EXPLICIT SYNTHETIC observation',evidence_id:e.evidence_id,quote:e.quote,quote_sha256:e.quote_sha256}],
  proposed_action:'EXPLICIT SYNTHETIC proposal, not an established cause',priority_reason:'EXPLICIT SYNTHETIC isolated observation, not recurrence'}];
 expect((await validateDirectReport(r,f.p,rs)).report.recommendations).toHaveLength(1);
 if(kind==='invented_quote')r.report.recommendations[0].observations[0].quote+='invented';
 if(kind==='wrong_category')r.report.recommendations[0].category='price';if(kind==='wrong_hash')r.report.recommendations[0].observations[0].quote_sha256='0'.repeat(64);
 if(kind==='no_observation')r.report.recommendations[0].observations=[];if(kind==='foreign_id')r.report.recommendations[0].evidence_ids=['foreign'];
 if(kind==='changed_counts')r.statistics_sha256='0'.repeat(64);
 await expect(validateDirectReport(r,f.p,rs)).rejects.toThrow();
});
it('does not reuse old theme questions just because their text, quote or former verdict is similar',async()=>{
 const f=await fixture(),g=f.groups[0],payload=structuredClone(g.payload);payload.questions[0].instructions='Historical 25-theme question';
 const prior=[{source_table:'EXPLICIT_SYNTHETIC',source_id:'old',organization_id:'org',review_id:g.review_id,payload,request_sha256:await directHash(payload)}];
 expect(await directLunaCompatibility(f.groups,prior,'org')).toMatchObject({checked_requests:1,reused_verdicts:0,audit:[{compatible:false}]});
 prior[0].payload=g.payload;prior[0].request_sha256=g.request_sha256;
 await expect(directLunaCompatibility(f.groups,prior,'org')).rejects.toThrow('VERDICT_RECEIPT_REQUIRED');
 prior[0].organization_id='foreign';await expect(directLunaCompatibility(f.groups,prior,'org')).rejects.toThrow('PRIOR_REQUEST_CHANGED');
});
it('keeps existing selector behavior on four structural selection keys without creating 25-theme results',async()=>{
 const f=await fixture(),view=f.all.map(e=>({...e,theme_key:e.category,axis:e.category==='ambiance'?'atmosphere':e.category,mixed_review:e.jev_native.classification==='mixed',
  status:'sol_candidate' as const,quality:{eligible:true,specificity:1,flags:[],reason:'synthetic',human_validated:false as const}}));
 const s=selectBalancedEvidence(view,32);expect(s.length).toBeLessThanOrEqual(32);expect(new Set(s.map(e=>e.review_id)).size).toBe(s.length);
 expect(s.every(e=>DIRECT_CATEGORY_KEYS.includes(e.category))).toBe(true);
});
it('refuses a fabricated source archive and keeps the Vietnamese fidelity and frequency instructions category-based',async()=>{
 const f=await fixture();await expect(verifyDirectReportSources(f.i)).rejects.toThrow('SOURCE_CHANGED');
 const prompt=directReportInstructions();expect(prompt).toContain('Vietnamese');expect(prompt).toContain('Category frequency is NOT');
 expect(prompt).toContain('ingredient');expect(prompt).toContain('proposed actions');expect(prompt).toContain('20 reviews have no text');
 expect(prompt).not.toContain('communication_difficulty');expect(prompt).not.toContain('food_preparation');
});
