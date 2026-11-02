// @vitest-environment node
// Synthetic regression cases only. The missing historical response is not replayed.
import Ajv from 'ajv';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {recommendationSheet} from '../fixtures/restaurant-recommendation-catalogue';
import {placeProfile} from '../../supabase/functions/_shared/google-place-profile';
import {aiHash,compareAi,prepareAi,renderChoices,type AiPort} from '../../supabase/functions/_shared/recommendation-ai';
import {coverageSchema,restoreCoveredChoices,validateCoveredDecision} from '../../supabase/functions/_shared/recommendation-criteria';
import {CRITERIA_VERSION,RECOMMENDATION_AI_VERSION,VALIDATOR_VERSION} from '../../supabase/functions/_shared/recommendation-versions';
const ajv=new Ajv({allErrors:true}),query={geography:'not_requested' as const};
function fixture(language:'fr'|'vi'){
 const a=recommendationSheet('candidate-a',{category:'quality',positive:language==='fr'?'Cuisine appréciée.':'Món ăn được đánh giá tốt.',reservation:language==='fr'?'Un plat froid, malgré un accueil apprécié.':'Món nguội, dù đón tiếp chu đáo.'}),b=recommendationSheet('candidate-b',{category:'service',positive:'Synthetic service evidence'});
 for(const row of [a,b]){row.language=language;row.publication!.language=language;}
 a.metadata.google_place_profile={...placeProfile([{cid:'123',language,scrapedAt:'2026-10-28T00:00:00Z',reviews:[],additionalInfo:{Amenities:[{'Family-friendly':false}]}}],{google_id:'123',place_id:null,google_maps_url:'https://www.google.com/maps?cid=123',language}),binding:{establishment_id:a.establishment_id,organization_id:a.organization_id}};
 const text=language==='fr'?'Si possible, un repas en famille et en terrasse.':'Nếu có thể, dùng bữa với gia đình ở ngoài trời.';
 const catalogue={rows:[a,b],organizationId:a.organization_id,language,establishments:[a,b].map(r=>({id:r.establishment_id,name:'Synthetic',organization_id:r.organization_id}))};
 const p=prepareAi(catalogue,query,text),native={criteria:(language==='fr'?['en famille','en terrasse']:['gia đình','ngoài trời']).map(quote=>({key:null,quote})),choices:[{id:a.establishment_id,reason_refs:['score_global'],criterion_evidence:[{criterion:0,state:'contradicted',refs:['feature_family_friendly']},{criterion:1,state:'unknown',refs:['feature_outdoor_seating']}],caution_refs:['feature_family_friendly','feature_outdoor_seating'],caution_bindings:[{ref:'feature_family_friendly',criterion:0 as number|null},{ref:'feature_outdoor_seating',criterion:1 as number|null}],alternative_ids:[] as string[]}]};
 return {p,native,text,catalogue};
}
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');})));
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});
describe.each(['fr','vi'] as const)('transmitted reference catalogue %s',language=>{
 it('accepts valid refs, including unknown information, and keeps null criteria distinct',()=>{
  const {p,native}=fixture(language),validate=ajv.compile(p.request.text.format.schema);expect(validate(native),JSON.stringify(validate.errors)).toBe(true);
  const input=JSON.parse(p.request.input),unknown=input.candidates[0].unknown_feature_refs;
  expect(unknown).toContain('feature_outdoor_seating');expect(input.candidates[0].facts.some((f:{ref:string})=>f.ref==='feature_outdoor_seating')).toBe(false);
  const choice=validateCoveredDecision(native,p)[0];expect(choice.criteria_spans?.map(s=>s.key)).toEqual([null,null]);expect(choice.criteria_spans?.[0]).not.toEqual(choice.criteria_spans?.[1]);
  const display=renderChoices([choice],p)[0];expect(display.coverage?.map(e=>e.state)).toEqual(['contradicted','unknown']);expect(display.cautions?.map(c=>c.caution_context?.criterion_indices)).toEqual([[0],[1]]);
 });
 it.each(['invented','feature_outdoor_seating ','Feature_outdoor_seating','feature_outdoor-seating','google_maps_practical'])('rejects an unknown or malformed ref without approximation: %s',ref=>{
  const {p,native}=fixture(language);native.choices[0].criterion_evidence[0].refs.push(ref);
  expect(ajv.compile(p.request.text.format.schema)(native)).toBe(false);
  expect(()=>validateCoveredDecision(native,p)).toThrow('INVALID_REFERENCE');
 });
 it('does not accept a ref just because another candidate owns it',()=>{
  const {p,native}=fixture(language);native.choices[0].criterion_evidence[0].refs=['strength_service_0'];
  expect(p.request.text.format.schema.$defs.fact_ref.enum).toContain('strength_service_0');expect(ajv.compile(p.request.text.format.schema)(native)).toBe(true);
  try{validateCoveredDecision(native,p);throw Error('UNEXPECTED_ACCEPTANCE');}catch(e){expect(e).toMatchObject({message:'INVALID_REFERENCE',diagnostic:{rule:'reference_not_in_candidate',choice_index:0,criterion_index:0,reference_index:0}});}
 });
 it('retains usage and relevance checks for real, locally owned refs',()=>{
  const {p,native}=fixture(language),badCriterion=structuredClone(native);badCriterion.choices[0].criterion_evidence[0].refs=['reservation_quality_0'];
  expect(ajv.compile(p.request.text.format.schema)(badCriterion)).toBe(true);expect(()=>validateCoveredDecision(badCriterion,p)).toThrow('INVALID_REFERENCE');
  const badCaution=structuredClone(native);badCaution.choices[0].caution_refs=['reservation_quality_0'];badCaution.choices[0].caution_bindings=[{ref:'reservation_quality_0',criterion:0}];
  expect(ajv.compile(p.request.text.format.schema)(badCaution)).toBe(true);expect(()=>validateCoveredDecision(badCaution,p)).toThrow('IRRELEVANT_CAUTION');
  const badReason=structuredClone(native);badReason.choices[0].reason_refs=['reservation_quality_0'];
  expect(ajv.compile(p.request.text.format.schema)(badReason)).toBe(true);expect(()=>validateCoveredDecision(badReason,p)).toThrow('INVALID_REFERENCE');
 });
 it('bounds every reference field to exactly the serialized wire catalogue',()=>{
  const {p,native}=fixture(language),input=JSON.parse(p.request.input),expected=[...new Set(input.candidates.flatMap((c:{facts:{ref:string}[];unknown_feature_refs:string[]})=>[...c.facts.map(f=>f.ref),...c.unknown_feature_refs]))].sort();
  expect(p.request.text.format.schema.$defs.fact_ref.enum).toEqual(expected);
  const props=p.request.text.format.schema.properties.choices.items.properties;
  for(const schema of [props.reason_refs.items,props.criterion_evidence.items.properties.refs.items,props.caution_refs.items,props.caution_bindings.items.properties.ref])expect(schema).toEqual({$ref:'#/$defs/fact_ref'});
  const changed=structuredClone(native);changed.choices[0].caution_bindings[0].ref='not_transmitted';expect(ajv.compile(p.request.text.format.schema)(changed)).toBe(false);
  p.facts.get('candidate-a')!.push({ref:'hidden_source_not_sent',kind:'strength',value:{},source:null,label:'Synthetic hidden value'});
  expect(p.request.text.format.schema.$defs.fact_ref.enum).not.toContain('hidden_source_not_sent');expect(p.request.input).not.toContain('hidden_source_not_sent');
 });
 it('keeps allowed empty lists and the nullable binding, without making unknown a positive claim',()=>{
  const {p,native}=fixture(language);native.choices[0].criterion_evidence[1].refs=[];native.choices[0].caution_refs=[];native.choices[0].caution_bindings=[];
  expect(ajv.compile(p.request.text.format.schema)(native)).toBe(true);expect(validateCoveredDecision(native,p)).toHaveLength(1);
  const generalCatalogue=fixture(language).catalogue;
  const noCriteria=prepareAi({...generalCatalogue,rows:generalCatalogue.rows.map(r=>({...r,stale:true,stale_reason:'CORPUS_CHANGED',publication:{...r.publication!,stale:true,stale_reason:'CORPUS_CHANGED'}}))},query,'');
  const general={criteria:[],choices:[{id:'candidate-a',reason_refs:['score_global'],criterion_evidence:[],caution_refs:['freshness'],caution_bindings:[{ref:'freshness',criterion:null}],alternative_ids:[]}]};
  expect(ajv.compile(noCriteria.request.text.format.schema)(general)).toBe(true);expect(validateCoveredDecision(general,noCriteria)).toHaveLength(1);
 });
 it('sends the bounded schema through the actual Responses preparation/transport path, using only mocks',async()=>{
  const {p,native,catalogue,text}=fixture(language),reserve=vi.fn(async()=>({id:'mock-attempt',owned:true,state:'dispatched',selection:null,metrics:null})),finish=vi.fn(async()=>{});
  const http=vi.fn<typeof fetch>(async(url,init)=>{
   expect(url).toBe('https://api.openai.com/v1/responses');const body=JSON.parse(String(init?.body)),input=JSON.parse(body.input);
   expect(body.text.format).toMatchObject({type:'json_schema',strict:true,name:'restaurant_selection'});expect(body.text.format.schema).toEqual(p.request.text.format.schema);
   expect(body.text.format.schema.$defs.fact_ref.enum).toEqual([...new Set(input.candidates.flatMap((c:{facts:{ref:string}[];unknown_feature_refs:string[]})=>[...c.facts.map(f=>f.ref),...c.unknown_feature_refs]))].sort());
   const validate=ajv.compile(body.text.format.schema);expect(validate(native),JSON.stringify(validate.errors)).toBe(true);
   return new Response(JSON.stringify({model:'gpt-6.1-sol',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(native)}]}]}));
  });
  const port:AiPort={reserve,finish};const result=await compareAi({catalogue,query,preference:text,userId:'synthetic',access:[],port,key:'offline-placeholder',http,unchanged:async()=>true});
  expect(result.status).toBe('completed');expect(http).toHaveBeenCalledTimes(1);expect(reserve).toHaveBeenCalledTimes(1);expect(finish).toHaveBeenCalledTimes(1);
 });
});
it('builds a valid empty-catalogue schema with no sentinel or empty enum',async()=>{
 const p=prepareAi({rows:[],organizationId:'org-a',language:'fr',establishments:[]},query,''),schema=p.request.text.format.schema,valid=ajv.compile(schema);
 expect(valid({criteria:[],choices:[]})).toBe(true);expect(schema.properties.choices.maxItems).toBe(0);expect(JSON.stringify(schema)).not.toContain('"enum":[]');
 const http=vi.fn<typeof fetch>(),reserve=vi.fn(async()=>{throw Error('NO_RESERVATION');});
 expect((await compareAi({catalogue:{rows:[],organizationId:'org-a',language:'fr',establishments:[]},query,preference:'',userId:'synthetic',access:[],port:{reserve,finish:vi.fn(async()=>{})},key:'offline-placeholder',http,unchanged:async()=>true})).notice).toBe('NO_CANDIDATES');expect(http).not.toHaveBeenCalled();expect(reserve).not.toHaveBeenCalled();
});
it('checks documented enum limits without truncating candidates or refs, and shares enums once',()=>{
 const candidates=(n:number,length=0)=>[{id:'candidate',facts:Array.from({length:n},(_,i)=>({ref:'r'+String(i).padStart(length,'0')})),unknown_feature_refs:[]}];
 expect(ajv.validateSchema(coverageSchema(candidates(993),[]))).toBe(true);expect(()=>coverageSchema(candidates(994),[])).toThrow('REFERENCE_SCHEMA_LIMIT');
 expect(()=>coverageSchema(candidates(251,61),[])).toThrow('REFERENCE_SCHEMA_LIMIT');expect(()=>coverageSchema(candidates(1,120000),[])).toThrow('REFERENCE_SCHEMA_LIMIT');
 expect(()=>coverageSchema([{id:'candidate',facts:[],unknown_feature_refs:[]}],[])).toThrow('INVALID_REFERENCE_CATALOGUE');
});
it('uses only the shortlisted wire candidates, never the whole available catalogue',()=>{
 const rows=Array.from({length:25},(_,i)=>recommendationSheet('candidate-'+i,{score:(5.8-i*.02).toFixed(2)}));
 const outside=rows[24];outside.metadata.google_place_profile={...placeProfile([{cid:'123',language:'vi',scrapedAt:'2026-10-28T00:00:00Z',reviews:[],additionalInfo:{Highlights:[{'Live music':true}]}}],{google_id:'123',place_id:null,google_maps_url:'https://www.google.com/maps?cid=123',language:'vi'}),binding:{establishment_id:outside.establishment_id,organization_id:outside.organization_id}};
 const p=prepareAi({rows,organizationId:rows[0].organization_id,language:'vi',establishments:rows.map(r=>({id:r.establishment_id,name:'Synthetic',organization_id:r.organization_id}))},query,'');
 expect(p.candidates).toHaveLength(20);expect(p.candidates.map(c=>c.id)).not.toContain(outside.establishment_id);expect(p.request.text.format.schema.$defs.fact_ref.enum).not.toContain('feature_live_music');
 const isolated=prepareAi({rows:[outside],organizationId:outside.organization_id,language:'vi',establishments:[{id:outside.establishment_id,name:'Synthetic',organization_id:outside.organization_id}]},query,'');expect(isolated.request.text.format.schema.$defs.fact_ref.enum).toContain('feature_live_music');
});
it('uses only the documented strict schema subset and local definitions in the Responses envelope',()=>{
 const schema=fixture('fr').p.request.text.format.schema,allowed=new Set(['type','additionalProperties','required','properties','items','minItems','maxItems','minimum','maximum','maxLength','enum','$defs','$ref']);
 let properties=0,enumValues=0,strings=0;
 function visit(s:Record<string,unknown>,depth=1){
  expect(depth).toBeLessThanOrEqual(10);for(const key of Object.keys(s))expect(allowed.has(key),'Unsupported schema keyword '+key).toBe(true);
  if(s.$ref){expect(typeof s.$ref).toBe('string');expect(Object.keys(schema.$defs)).toContain(String(s.$ref).replace('#/$defs/',''));}
  if(s.type==='object'){
   expect(s.additionalProperties).toBe(false);expect([...(s.required as string[])].sort()).toEqual(Object.keys(s.properties as object).sort());
   const p=s.properties as Record<string,Record<string,unknown>>;properties+=Object.keys(p).length;strings+=Object.keys(p).join('').length;Object.values(p).forEach(v=>visit(v,depth+1));
  }
  if(s.items)visit(s.items as Record<string,unknown>,depth+1);
  if(s.$defs){const defs=s.$defs as Record<string,Record<string,unknown>>;strings+=Object.keys(defs).join('').length;Object.values(defs).forEach(d=>visit(d,depth));}
  if(s.enum){const e=s.enum as unknown[];expect(e.length).toBeGreaterThan(0);enumValues+=e.length;const length=e.reduce<number>((n,x)=>n+(typeof x==='string'?x.length:0),0);strings+=length;if(e.length>250)expect(length).toBeLessThanOrEqual(15000);}
 }
 expect(schema.type).toBe('object');visit(schema);expect(properties).toBeLessThanOrEqual(5000);expect(enumValues).toBeLessThanOrEqual(1000);expect(strings).toBeLessThanOrEqual(120000);expect(ajv.validateSchema(schema)).toBe(true);
});
it('keeps the bounded wire contract, versions the proof/cache changes and rejects old cached coverage',async()=>{
 const {p,native}=fixture('fr'),stored=validateCoveredDecision(native,p);expect(CRITERIA_VERSION).toBe('recommendation-criteria-coverage-v3');expect(RECOMMENDATION_AI_VERSION).toBe('recommendation-ai-open-criteria-safety-v9');expect(VALIDATOR_VERSION).toBe('recommendation-criteria-validator-v3');
 stored[0].coverage_version='recommendation-criteria-coverage-v2' as typeof CRITERIA_VERSION;expect(()=>restoreCoveredChoices(stored,p)).toThrow('CACHE_INCOMPATIBLE');
 const legacy=structuredClone(p.request),input=JSON.parse(legacy.input);input.configuration_version='recommendation-ai-open-criteria-safety-v8';legacy.input=JSON.stringify(input);
 expect(await aiHash(legacy)).not.toBe(await aiHash(p.request));
});
