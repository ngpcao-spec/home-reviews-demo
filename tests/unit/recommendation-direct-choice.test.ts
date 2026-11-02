// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import Ajv from 'ajv';
import {recommendationSheet} from '../fixtures/restaurant-recommendation-catalogue';
import {prepareAi,prepareDirectAi,renderChoices,compareAi,type Choice} from '../../supabase/functions/_shared/recommendation-ai';
import {validateDirectDecision,restoreDirectChoices} from '../../supabase/functions/_shared/recommendation-direct-choice';
import type {RecommendationTrace} from '../../supabase/functions/_shared/recommendation-diagnostics';
const query={geography:'not_requested' as const};
function fixture(language:'fr'|'vi'){
 const rows=[recommendationSheet('a',{reservation:'Un plat froid, malgré un accueil apprécié.'}),recommendationSheet('b')];for(const r of rows){r.language=language;r.publication!.language=language;}
 const catalogue={rows,language,organizationId:rows[0].organization_id,establishments:rows.map(r=>({id:r.establishment_id,name:r.establishment_id,organization_id:r.organization_id}))};
 const preference=language==='fr'?'En famille avec des enfants, dehors si possible, sans exiger le calme.':'Đi cùng gia đình và trẻ em, ngoài trời nếu có thể, không cần yên tĩnh.';
 const prepared=prepareDirectAi(catalogue,query,preference);
 const raw={choices:[{id:'a',explanation:language==='fr'?'Je propose cette option pour votre repas, avec les limites indiquées.':'Tôi đề xuất lựa chọn này cho bữa ăn, với những hạn chế đã nêu.',caution:language==='fr'?'La cuisson mérite votre attention.':'Nên lưu ý chất lượng nấu nướng.',uncertainties:[language==='fr'?'Les équipements pour enfants restent inconnus.':'Chưa rõ tiện nghi cho trẻ em.'],source_refs:['score_global','reservation_quality_0']}]};
 return {catalogue,preference,prepared,raw};
}
describe.each(['fr','vi'] as const)('direct model assessment %s',language=>{
 it('sends complete facts and identical candidate scores, with a simple exploitable schema',()=>{
  const f=fixture(language),old=prepareAi(f.catalogue,query,f.preference),input=JSON.parse(f.prepared.request.input),schema=f.prepared.request.text.format.schema;
  expect(f.prepared.proposals).toEqual(old.proposals);expect(f.prepared.facts).toEqual(old.facts);expect(f.prepared.candidates.map(c=>c.id)).toEqual(old.candidates.map(c=>c.id));
  expect(input.natural_language_request).toBe(f.preference);expect(input).not.toHaveProperty('criterion_hints');expect(input.candidates.every((c:object)=>!Object.hasOwn(c,'criterion_observations'))).toBe(true);
  expect(JSON.stringify(schema)).not.toMatch(/criterion_evidence|caution_bindings|documented|partial|unknown/);expect(new Ajv().compile(schema)(f.raw)).toBe(true);
 });
 it('accepts arbitrary free criteria, contexts, cautions and uncertainty without semantic attestation',()=>{
  const f=fixture(language);Object.assign(f.raw.choices[0],{explanation:'A model claim that may disagree with the source.',caution:'A subjective tradeoff with no criterion binding.',source_refs:[]});
  const choices=validateDirectDecision(f.raw,f.prepared),rendered=renderChoices(choices,f.prepared);
  expect(rendered[0].ai).toMatchObject({explanation:f.raw.choices[0].explanation,caution:f.raw.choices[0].caution,independently_verified:false,sources:[]});expect(rendered[0]).not.toHaveProperty('coverage');
 });
 it.each([[],['not-in-candidate'],['feature_unknown'],['reservation_service_999'],['score_global','not-in-candidate']].map(refs=>({refs})))('omits unusable sources without rejecting a usable response: $refs',({refs})=>{
  const f=fixture(language);f.raw.choices[0].source_refs=refs;const r=renderChoices(validateDirectDecision(f.raw,f.prepared),f.prepared)[0];
  expect(r.ai!.explanation).toBe(f.raw.choices[0].explanation);expect(r.ai!.source_refs).toEqual(refs.filter(r=>r==='score_global'));expect(r.ai!.sources.every(s=>s.ref==='score_global')).toBe(true);expect(r.ai!.omitted_source_count).toBe(refs.filter(r=>r!=='score_global').length);
 });
 it('keeps real but unrelated references as optional citations without attesting relevance',()=>{
  const f=fixture(language);f.raw.choices[0].source_refs=['reservation_quality_0'];const r=renderChoices(validateDirectDecision(f.raw,f.prepared),f.prepared)[0];expect(r.ai!.sources).toHaveLength(1);expect(r.ai!.independently_verified).toBe(false);
 });
 it('optional absent/null/malformed reference metadata does not defeat core format',()=>{
  const f=fixture(language);const r=validateDirectDecision({choices:[{id:'a',explanation:'Usable',source_refs:[42,null,'invented'],uncertainties:null}]},f.prepared)[0];expect(r.ai).toMatchObject({source_refs:[],omitted_source_count:3,uncertainties:[],caution:null});
  expect(validateDirectDecision({choices:[]},f.prepared)).toEqual([]);
 });
 it.each(['outside','duplicate','too_many','no_explanation','wrong_choices'])('rejects structural violations: %s',kind=>{
  const f=fixture(language),choice=f.raw.choices[0];const raw=kind==='outside'?{choices:[{...choice,id:'outside'}]}:kind==='duplicate'?{choices:[choice,choice]}:kind==='too_many'?{choices:[choice,choice,choice,choice]}:kind==='no_explanation'?{choices:[{id:'a'}]}:{choices:'bad'};
  expect(()=>validateDirectDecision(raw,f.prepared)).toThrow('INVALID_SELECTION');
 });
 it('does not borrow another candidate’s reference or display model HTML as a link',()=>{
  const f=fixture(language);const unique=f.prepared.facts.get('b')!.find(x=>x.kind==='strength')!;f.prepared.facts.get('a')!.splice(f.prepared.facts.get('a')!.findIndex(x=>x.ref===unique.ref),1);
  const r=validateDirectDecision({choices:[{id:'a',explanation:'<script>alert(1)</script>',source_refs:[unique.ref]}]},f.prepared);expect(r[0].ai!.source_refs).toEqual([]);expect(renderChoices(r,f.prepared)[0].ai!.explanation).toContain('<script>');
 });
 it('rejects old cached formats and keeps new cached model text without semantic revalidation',()=>{
  const f=fixture(language),a=validateDirectDecision(f.raw,f.prepared);expect(restoreDirectChoices(a,f.prepared)).toEqual(a);
  expect(()=>restoreDirectChoices([{id:'a',reason_refs:['score_global'],caution_ref:null}],f.prepared)).toThrow('CACHE_INCOMPATIBLE');
 });
 it('records structural-only success, shares one in-flight attempt and never pays for cache reuse',async()=>{
  const f=fixture(language),traces:RecommendationTrace[]=[],record:{selection:Choice[]|null;state:string}={selection:null,state:'dispatched'};let first=true,release!:()=>void;
  const http=vi.fn<typeof fetch>(async()=>{await new Promise<void>(r=>{release=r;});return new Response(JSON.stringify({model:'gpt-6.1-sol',status:'completed',usage:{input_tokens:10,output_tokens:5},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(f.raw)}]}]}));});
  const reserve=vi.fn(async()=>{const owned=first;first=false;return {id:'one-attempt',owned,...record,metrics:null};});const finish=vi.fn(async(_id:string,state:string,selection:Choice[]|null)=>{record.state=state;record.selection=selection;});
  const args={catalogue:f.catalogue,query,preference:f.preference,userId:'user',access:[],key:'offline-placeholder',http,port:{reserve,finish},unchanged:async()=>true,onDiagnostic:(t:RecommendationTrace)=>traces.push(t)};
  const pending=compareAi(args);await vi.waitFor(()=>expect(http).toHaveBeenCalledTimes(1));expect((await compareAi(args)).status).toBe('pending');release();expect((await pending).status).toBe('completed');expect((await compareAi(args)).status).toBe('cached');expect(http).toHaveBeenCalledTimes(1);expect(finish).toHaveBeenCalledTimes(1);
  expect(traces.find(t=>t.stage==='completed')).toMatchObject({validator_version:'recommendation-structural-validator-v1',contract_version:'recommendation-direct-choice-v1',failure:null});
 });
});
