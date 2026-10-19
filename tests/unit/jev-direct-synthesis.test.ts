import {it,expect,beforeAll,afterAll,vi} from 'vitest';
import {DIRECT_CONFIG,directHash,directCanonical,directCategoryCounts,parseDirectCategoriesRounded,DIRECT_CATEGORY_KEYS} from '../../supabase/functions/_shared/jev-direct-categories';
import {DIRECT_SYNTHESIS_VERSION,DIRECT_SYNTHESIS_POLICY,prepareDirectReport,directAcceptedSol,parseDirectReportLuna,
 directEvidenceFlow,balancedDirectReportInstructions,validateDirectReport,DIRECT_REPORT_FORMAT,
 type DirectReportInput,type DirectLunaGroup} from '../../supabase/functions/_shared/jev-direct-report-preparation';
import {directMockRaw} from '../fixtures/jev-direct-categories';
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text';
let net:ReturnType<typeof vi.spyOn>;
beforeAll(()=>{net=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('ALL_PROVIDER_NETWORK_FORBIDDEN'));});
afterAll(()=>{expect(net).not.toHaveBeenCalled();net.mockRestore();});
async function fixture(){
 const texts=['The floor was dirty, the steak cold, but the waiter was kind.',
  'Prices were expensive for our budget.', 'Our soup arrived burnt and tasted bitter.', 'The chairs were uncomfortable and the music loud.',
  'A warm welcome and prompt assistance made dinner enjoyable.', 'A very fair bill for a generous experience.',
  'The fresh noodles and fragrant herbs were delicious.', 'We enjoyed a peaceful terrace with comfortable sofas.',
  'The team checked our table and brought the requested napkins.', 'Excellent value for the amount received.',
  'Tender fish with crisp vegetables and a beautiful presentation.', 'The calm garden lighting suited a family gathering.',
  'Our reservation was handled smoothly by the host.', 'Affordable lunch choices made the visit worthwhile.',
  'Rich chocolate dessert and perfectly brewed coffee.', 'Elegant decoration and a spotless dining room.'];
 const reviews=await Promise.all(Array.from({length:20},async(_,n)=>{
  const text=n<16?texts[n]:null;
  return {id:'synthetic_'+n,organization_id:'org',establishment_id:'est',rating:n===0?2:5,
   original_text:text?'VĂN BẢN GỐC TỔNG HỢP '+n:'',original_text_sha256:await directHash(null),
   analysis_text:text,analysis_text_sha256:text?await analysisTextSha256(text):null};
 }));
 for(const r of reviews)r.original_text_sha256=await analysisTextSha256(r.original_text);
 const rows=await Promise.all(reviews.filter(r=>r.analysis_text).map(async(r,n)=>{
  const raw=directMockRaw(n===0?{quality:'negative',ambiance:'negative',service:'mixed'}:{[DIRECT_CATEGORY_KEYS[n%4]]:n<4?'negative':'positive'}),
   result=parseDirectCategoriesRounded(raw),wire=JSON.stringify(raw);
  return {review_id:r.id,analysis_text:r.analysis_text!,analysis_text_sha256:r.analysis_text_sha256!,analysis_language:'en',organization_id:'org',establishment_id:'est',
   result,result_sha256:await directHash(result),raw_response_text:wire,response_raw_sha256:await analysisTextSha256(wire),
   translation_source:'synthetic_frozen_translation',translation_provenance:{explicit_mock:true},receipt_id:r.id};
 }));
 const db={version:'jev-direct-categories4-dataset-v1',configuration_id:DIRECT_CONFIG.id,configuration_sha256:await directHash(DIRECT_CONFIG),
  reviews:rows,counts:directCategoryCounts(rows.map(r=>r.review_id),rows)},sb={reviews,source_reviews_sha256:await directHash(reviews)};
 const input:DirectReportInput={dataset:{id:'dataset',protocol_id:'protocol',organization_id:'org',body:db,sha256:await directHash(db)},
  snapshot:{id:'snapshot',protocol_id:'protocol',organization_id:'org',body:sb,sha256:await directHash(sb)},prior_luna_requests:[]};
 const binding={dataset_id:'dataset',dataset_sha256:input.dataset.sha256,snapshot_id:'snapshot',snapshot_sha256:input.snapshot.sha256,source_reviews:20,text_reviews:16};
 const code='0'.repeat(40),legacy=await prepareDirectReport(input,code,binding),next=await prepareDirectReport(input,code,binding,DIRECT_SYNTHESIS_VERSION);
 return {input,binding,code,legacy,next};
}
function mock(g:DirectLunaGroup,choice='supported',confidence=1){return {model:'gpt-6-luna',usage:{input_tokens:10,output_tokens:0,total_tokens:10},
 answers:g.evidence_ids.map(name=>({name,type:'choice',choice,confidence,probabilities:['supported','unsupported','uncertain'].map(value=>({value,probability:value===choice?1:0}))}))};}
async function mockResults(f:Awaited<ReturnType<typeof fixture>>){return Promise.all(f.next.body.luna_groups.map(g=>parseDirectReportLuna(g,mock(g))));}
it('opts in separately, retains classifications, native probabilities and counters, and leaves the default V1 deterministic',async()=>{
 const f=await fixture(),before=await directHash(f.input);
 expect(f.next.body.version).toBe(DIRECT_SYNTHESIS_VERSION);expect(f.legacy.body.synthesis).toBeUndefined();
 expect((await prepareDirectReport(f.input,f.code,f.binding)).sha256).toBe(f.legacy.sha256);
 expect(f.next.body.statistics).toEqual(f.legacy.body.statistics);expect(f.next.body.configuration).toMatchObject(f.legacy.body.configuration);
 expect(f.next.body.configuration_sha256).not.toBe(f.legacy.body.configuration_sha256);
 expect(await directHash(f.input)).toBe(before);expect(f.next.body).toMatchObject({provider_calls:0,spending_authorization:null,run_id:null,production_enabled:false,
  max_jev_calls:0,max_sol_calls:1,automatic_retry:false});expect(f.next.body.max_luna_calls).toBeLessThanOrEqual(32);
});
it('keeps distinct associations of one review without duplicating identical associations or relaxing the two-per-review cap',async()=>{
 const f=await fixture(),selected=f.next.body.selection.selected;
 expect(selected.filter(e=>e.review_id==='synthetic_0')).toHaveLength(2);
 expect(f.legacy.body.selection.selected.filter(e=>e.review_id==='synthetic_0')).toHaveLength(1);
 expect(new Set(selected.map(e=>e.evidence_id)).size).toBe(selected.length);
 for(const id of new Set(selected.map(e=>e.review_id)))expect(selected.filter(e=>e.review_id===id).length).toBeLessThanOrEqual(2);
 expect(f.next.body.luna_groups.find(g=>g.review_id==='synthetic_0')!.payload.questions).toHaveLength(2);
 // Identical candidate IDs still carry exactly the historical category question and confidence policy.
 for(const g of f.next.body.luna_groups)for(const q of g.payload.questions){
  const old=f.legacy.body.luna_groups.flatMap(g=>g.payload.questions).find(x=>x.name===q.name);if(old)expect(q).toEqual(old);
 }
 expect(DIRECT_SYNTHESIS_POLICY).toMatchObject({paid_enabled:false,production_enabled:false,max_per_review:2});
});
it('provides exact original/translation context only for accepted review sources, preserving hashes and server counts',async()=>{
 const f=await fixture(),rs=await mockResults(f),g=f.next.body.luna_groups.at(-1)!;
 rs[rs.length-1]=await parseDirectReportLuna(g,mock(g,'unsupported'));
 const b=await directAcceptedSol(f.next,rs);expect(b.gate.passed).toBe(true);
 const packet=b.draft!.packet,stats=packet.statistics as typeof f.next.body.statistics;
 expect(stats.scope).toEqual(f.next.body.statistics.scope);expect(stats.star_distribution_all).toEqual(f.next.body.statistics.star_distribution_all);
 for(const k of DIRECT_CATEGORY_KEYS){expect(stats.counts.categories[k].exclusive).toEqual(f.next.body.statistics.counts.categories[k].exclusive);
  expect(stats.counts.categories[k].positive_including_mixed).toBe(f.next.body.statistics.counts.categories[k].positive_including_mixed);
  expect(stats.counts.categories[k].positive_review_ids).toBeUndefined();}
 expect(packet.statistics_sha256).toBe(f.next.body.statistics_sha256);
 for(const o of packet.original_reviews!){const src=f.input.snapshot.body.reviews.find(r=>r.id===o.review_id)!;
  expect(o.original_text).toBe(src.original_text);expect(o.original_text_sha256).toBe(src.original_text_sha256);
  expect(packet.evidence.some(e=>e.review_id===o.review_id)).toBe(true);}
 expect(packet.original_reviews!.some(o=>o.review_id===g.review_id)).toBe(false);
 expect(packet.evidence.some(e=>g.evidence_ids.includes(e.evidence_id))).toBe(false);
 expect(b.draft!.measurement.guarded_input_tokens).toBeLessThanOrEqual(32768);
});
it('traces selection, rejection, abstention and synthesis omissions without calling them incident frequencies or quality scores',async()=>{
 const f=await fixture(),rs=await mockResults(f);
 rs[0]=await parseDirectReportLuna(f.next.body.luna_groups[0],mock(f.next.body.luna_groups[0],'unsupported'));
 rs[1]=await parseDirectReportLuna(f.next.body.luna_groups[1],mock(f.next.body.luna_groups[1],'supported',.59));
 const ds=rs.flatMap(r=>r.decisions),accepted=ds.filter(d=>d.status==='ACCEPTED');
 const flow=directEvidenceFlow(f.next.body.selection.candidates,f.next.body.selection.selected,ds,[accepted[0].evidence_id]);
 expect(flow.semantic_accuracy_measured).toBe(false);expect(flow.unit).toContain('not_incident');
 expect(flow.by_category_polarity.flatMap(x=>x.rejected).length).toBeGreaterThan(0);
 expect(flow.by_category_polarity.flatMap(x=>x.uncertain).length).toBeGreaterThan(0);
 expect(flow.by_category_polarity.flatMap(x=>x.omitted_at_selection).length).toBeGreaterThan(0);
 expect(flow.by_category_polarity.flatMap(x=>x.referenced)).toEqual([accepted[0].evidence_id]);
 expect(flow.by_category_polarity.flatMap(x=>x.accepted_not_referenced)).toHaveLength(accepted.length-1);
});
it('checks the new prompt contract, not the semantic quality of a simulated model response',()=>{
 const prompt=balancedDirectReportInstructions();
 for(const clause of ['strongly positive corpus','isolated complaint','No negative subsection','same incident in distinct reviews',
  'original_reviews','not a new Luna verdict','Category frequency is NOT','Do not force a fixed number'])expect(prompt).toContain(clause);
 expect(prompt).not.toMatch(/Bistro|Chill|cocktail|VIP/);
});
it('rejects altered original provenance and continues to allow no recommendations and no negative aspects in a technical mock',async()=>{
 const f=await fixture(),rs=await mockResults(f),b=await directAcceptedSol(f.next,rs);
 const raw={format_version:DIRECT_REPORT_FORMAT,statistics_sha256:f.next.body.statistics_sha256,report:{
  categories:DIRECT_CATEGORY_KEYS.map(category=>({category,text:'MÔ PHỎNG KỸ THUẬT',evidence_ids:[b.accepted.find(e=>e.category===category)!.evidence_id]})),
  positive_aspects:[],negative_aspects:[],recommendations:[],conclusion:{text:'MÔ PHỎNG',evidence_ids:[b.accepted[0].evidence_id]}}};
 expect((await validateDirectReport(raw,f.next,rs)).technical_checks_passed).toBe(true);
 const changed=structuredClone(f.next);changed.body.synthesis!.originals[0].original_text+=' changed';
 changed.body.synthesis!.originals_sha256=await directHash(changed.body.synthesis!.originals);changed.sha256=await directHash(changed.body);
 await expect(directAcceptedSol(changed,rs)).rejects.toThrow('ORIGINAL_CONTEXT_CHANGED');
 expect(directCanonical(f.next.body.statistics)).toBe(directCanonical(f.legacy.body.statistics));
});
