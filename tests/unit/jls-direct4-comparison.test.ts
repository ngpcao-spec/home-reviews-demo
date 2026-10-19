import {it,expect,vi,beforeAll,afterAll} from 'vitest';
import {readFileSync} from 'node:fs';
import {DIRECT_CONFIG,DIRECT_CATEGORY_KEYS,directHash,directCategoryCounts,parseDirectCategoriesRounded} from '../../supabase/functions/_shared/jev-direct-categories';
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text';
import {DIRECT_SYNTHESIS_VERSION,prepareDirectReport,directReportLunaGroups,directAcceptedSol,parseDirectReportLuna,type DirectReportInput,type DirectLunaGroup} from '../../supabase/functions/_shared/jev-direct-report-preparation';
import {directMockRaw} from '../fixtures/jev-direct-categories';
let network:ReturnType<typeof vi.spyOn>;
beforeAll(()=>{network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('PROVIDER_FORBIDDEN'));});
afterAll(()=>{expect(network).not.toHaveBeenCalled();network.mockRestore();});
async function fixture(){
 const reviews=await Promise.all(Array.from({length:16},async(_,n)=>{const text='EXPLICIT SYNTHETIC REVIEW '+n;
  return {id:'synthetic_'+n,organization_id:'org',establishment_id:'est',rating:5,original_text:text,
   original_text_sha256:await analysisTextSha256(text),analysis_text:text,analysis_text_sha256:await analysisTextSha256(text)};}));
 const rows=await Promise.all(reviews.map(async(r,n)=>{const raw=directMockRaw(n===0?{service:'negative',quality:'negative',ambiance:'negative'}:{[DIRECT_CATEGORY_KEYS[n%4]]:'positive'}),
  result=parseDirectCategoriesRounded(raw),wire=JSON.stringify(raw);
  return {review_id:r.id,analysis_text:r.analysis_text,analysis_text_sha256:r.analysis_text_sha256,analysis_language:'en',organization_id:'org',establishment_id:'est',result,
   result_sha256:await directHash(result),raw_response_text:wire,response_raw_sha256:await analysisTextSha256(wire),translation_source:'original',translation_provenance:{explicit_mock:true},receipt_id:r.id};}));
 const db={version:'jev-direct-categories4-dataset-v1',configuration_id:DIRECT_CONFIG.id,configuration_sha256:await directHash(DIRECT_CONFIG),reviews:rows,counts:directCategoryCounts(rows.map(r=>r.review_id),rows)},sb={reviews,source_reviews_sha256:await directHash(reviews)};
 const input:DirectReportInput={dataset:{id:'dataset',protocol_id:'protocol',organization_id:'org',body:db,sha256:await directHash(db)},snapshot:{id:'snapshot',protocol_id:'protocol',organization_id:'org',body:sb,sha256:await directHash(sb)},prior_luna_requests:[]};
 const binding={dataset_id:'dataset',dataset_sha256:input.dataset.sha256,snapshot_id:'snapshot',snapshot_sha256:input.snapshot.sha256,source_reviews:16,text_reviews:16},code='0'.repeat(40),
  normal=await prepareDirectReport(input,code,binding,DIRECT_SYNTHESIS_VERSION),ids=normal.body.selection.candidates.map(e=>e.evidence_id),
  comparison=await prepareDirectReport(input,code,binding,DIRECT_SYNTHESIS_VERSION,ids);
 return {input,binding,code,normal,comparison};
}
function mock(g:DirectLunaGroup,choice='supported'){return {model:'gpt-6-luna',usage:{input_tokens:1,output_tokens:0,total_tokens:1},answers:g.evidence_ids.map(name=>({name,type:'choice',choice,confidence:1,probabilities:['supported','unsupported','uncertain'].map(value=>({value,probability:value===choice?1:0}))}))};}
it('explicit comparison keeps three distinct category sources without changing the default two-per-review policy or counts',async()=>{
 const f=await fixture();expect(f.normal.body.selection.selected.filter(e=>e.review_id==='synthetic_0')).toHaveLength(2);
 expect(f.comparison.body.selection.selected.filter(e=>e.review_id==='synthetic_0')).toHaveLength(3);
 expect(f.comparison.body.statistics).toEqual(f.normal.body.statistics);
 expect(f.comparison.body.configuration_sha256).not.toBe(f.normal.body.configuration_sha256);
 expect((await prepareDirectReport(f.input,f.code,f.binding,DIRECT_SYNTHESIS_VERSION)).sha256).toBe(f.normal.sha256);
 const id=f.comparison.body.selection.selected[0].evidence_id;
 await expect(prepareDirectReport(f.input,f.code,f.binding,undefined,[id])).rejects.toThrow('COMPARISON_SELECTION_INVALID');
 await expect(prepareDirectReport(f.input,f.code,f.binding,DIRECT_SYNTHESIS_VERSION,[id,id])).rejects.toThrow('COMPARISON_SELECTION_INVALID');
});
it('reuses a native request unchanged and separately verifies other categories of the same review, without verdict transfer',async()=>{
 const f=await fixture(),p=f.comparison,es=p.body.selection.selected.filter(e=>e.review_id==='synthetic_0'),other=p.body.luna_groups.filter(g=>g.review_id!=='synthetic_0'),
  saved=(await directReportLunaGroups(es.slice(0,1)))[0],pending=(await directReportLunaGroups(es.slice(1)))[0];
 const savedWire=JSON.stringify(saved),savedResult=await parseDirectReportLuna(saved,mock(saved));
 p.body.luna_groups=[saved,...other,pending];p.body.luna_groups_sha256=await directHash(p.body.luna_groups);p.sha256=await directHash(p.body);
 const results=[savedResult,...await Promise.all(other.map(g=>parseDirectReportLuna(g,mock(g)))),await parseDirectReportLuna(pending,mock(pending,'uncertain'))],
  branch=await directAcceptedSol(p,results);
 expect(branch.accepted.some(e=>e.evidence_id===es[0].evidence_id)).toBe(true);
 expect(branch.accepted.some(e=>pending.evidence_ids.includes(e.evidence_id))).toBe(false);
 expect(branch.decisions.filter(d=>es.some(e=>e.evidence_id===d.evidence_id)).map(d=>d.status)).toEqual(['ACCEPTED','UNCERTAIN','UNCERTAIN']);
 expect(JSON.stringify(saved)).toBe(savedWire);expect(results[0]).toEqual(savedResult);
 await expect(directAcceptedSol(p,[...results.slice(0,-1),savedResult])).rejects.toThrow('LUNA_INCOMPLETE_OR_PLAN_CHANGED');
 const wrong=structuredClone(results);wrong.at(-1)!.review_id='another_review';
 await expect(directAcceptedSol(p,wrong)).rejects.toThrow('LUNA_RESULT_CHANGED');
});
it('does not silently reselect rejected candidates or enable a current report, GET launch, or provider retries',()=>{
 const sql=readFileSync('supabase/migrations/20261019152717_jls_direct4_synthesis_comparison.sql','utf8');
 for(const s of ['DIRECT_COMPARISON_NEW_GO_REQUIRED','DIRECT_COMPARISON_DEPLOYED_QUALIFICATION_REQUIRED','request_count=1','for update skip locked','revoke all on function'])expect(sql).toContain(s);
 expect(sql).not.toMatch(/^\s*(?:select|perform) public\.(?:authorize|wake)_/mi);
 const read=readFileSync('supabase/functions/jls-restaurant/index.ts','utf8');expect(read).toContain('if(selectedProtocol)pq=pq.eq');
 const server=readFileSync('supabase/functions/process-jls-restaurant/index.ts','utf8');
 expect(server.indexOf("mode==='direct4_comparison_probe'")).toBeLessThan(server.indexOf('Deno.env.get("OPENAI_API_KEY")'));
});
