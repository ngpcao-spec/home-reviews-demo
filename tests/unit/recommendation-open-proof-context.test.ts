// @vitest-environment node
// Synthetic FR/VI branch reproductions, never a replay of the missing real reply.
import Ajv from 'ajv';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {recommendationSheet} from '../fixtures/restaurant-recommendation-catalogue';
import {placeProfile} from '../../supabase/functions/_shared/google-place-profile';
import {prepareAi,renderChoices} from '../../supabase/functions/_shared/recommendation-ai';
import {validateCoveredDecision,verifiedOpenCriterion} from '../../supabase/functions/_shared/recommendation-criteria';

type Language='fr'|'vi';
type Feature='family_friendly'|'kids'|'outdoor_seating';
const query={geography:'not_requested' as const};
const examples=[
 {name:'optional phrase inside both quotes',language:'fr',text:'Un repas en famille si possible ; une terrasse si possible.',quotes:['en famille si possible','une terrasse si possible'],subjects:['family_friendly','outdoor_seating']},
 {name:'optional phrase inside both quotes',language:'vi',text:'Dùng bữa với gia đình nếu có thể; chỗ ngồi ngoài trời nếu có thể.',quotes:['gia đình nếu có thể','chỗ ngồi ngoài trời nếu có thể'],subjects:['family_friendly','outdoor_seating']},
 {name:'plural family and exterior',language:'fr',text:"Si possible, pour les familles et à l’extérieur.",quotes:['pour les familles','à l’extérieur'],subjects:['family_friendly','outdoor_seating']},
 {name:'children and outdoor seating',language:'fr',text:'Si possible, un restaurant adapté aux enfants et une terrasse.',quotes:['adapté aux enfants','une terrasse'],subjects:['kids','outdoor_seating']},
 {name:'children and outdoor seating',language:'vi',text:'Nếu có thể, một nơi phù hợp với trẻ em và chỗ ngồi ngoài trời.',quotes:['phù hợp với trẻ em','chỗ ngồi ngoài trời'],subjects:['kids','outdoor_seating']},
 {name:'whole optional quote with punctuation',language:'fr',text:'Si possible, une terrasse.',quotes:['Si possible, une terrasse.'],subjects:['outdoor_seating']},
 {name:'whole optional quote with punctuation',language:'vi',text:'Nếu có thể, có chỗ ngồi ngoài trời.',quotes:['Nếu có thể, có chỗ ngồi ngoài trời.'],subjects:['outdoor_seating']},
] as const;
function fixture(language:Language,text:string,quotes:readonly string[],subjects:readonly Feature[],values:Partial<Record<Feature,boolean>>={family_friendly:true,kids:true,outdoor_seating:true}){
 const row=recommendationSheet('synthetic-proof-owner',{category:'quality',positive:language==='fr'?'Cuisine appréciée.':'Món ăn được đánh giá tốt.',reservation:language==='fr'?'Un plat froid, malgré un accueil apprécié.':'Một món nguội dù được đón tiếp chu đáo.'});row.language=language;row.publication!.language=language;
 const labels:Record<Feature,string>={family_friendly:'Family-friendly',kids:'Good for kids',outdoor_seating:'Outdoor seating'};
 row.metadata.google_place_profile={...placeProfile([{cid:'123',language,scrapedAt:'2026-10-28T00:00:00Z',reviews:[],additionalInfo:{Amenities:Object.entries(values).map(([k,v])=>({[labels[k as Feature]]:v}))}}],{google_id:'123',place_id:null,google_maps_url:'https://www.google.com/maps?cid=123',language}),binding:{establishment_id:row.establishment_id,organization_id:row.organization_id}};
 const catalogue={rows:[row],language,organizationId:row.organization_id,establishments:[{id:row.establishment_id,name:'Synthetic',organization_id:row.organization_id}]};
 const p=prepareAi(catalogue,query,text),native={criteria:quotes.map(quote=>({key:null,quote})),choices:[{id:row.establishment_id,reason_refs:['score_global'],criterion_evidence:subjects.map((subject,criterion)=>({criterion,state:values[subject]===undefined?'unknown':values[subject]?'documented':'contradicted',refs:['feature_'+subject]})),caution_refs:[] as string[],caution_bindings:[] as {ref:string;criterion:number|null}[],alternative_ids:[] as string[]}]};
 return {p,native,catalogue};
}
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');})));
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});
describe('open subject proof, optionality and canonical refs',()=>{
 it.each(examples)('$language $name',({language,text,quotes,subjects})=>{
  const {p,native}=fixture(language,text,quotes,subjects);expect(p.criteriaHints).toEqual([]);
  expect(new Ajv().compile(p.request.text.format.schema)(native)).toBe(true);
  expect(native.criteria.map(c=>verifiedOpenCriterion(p,c)?.key)).toEqual(subjects.map(s=>'feature_'+s));
  const choices=validateCoveredDecision(native,p),display=renderChoices(choices,p)[0];
  expect(display.coverage?.map(c=>c.state)).toEqual(subjects.map(()=>'documented'));expect(display.coverage?.map(c=>c.key)).toEqual(subjects.map(()=>null));
  expect(choices[0].criteria_spans?.map(s=>text.slice(s.start,s.end))).toEqual(quotes);
  expect(JSON.parse(p.request.input).natural_language_request).toBe(text);
 });
 it.each(['fr','vi'] as const)('keeps unknown family and documented exterior separate %s',language=>{
  const e=examples.find(e=>e.language===language&&e.name==='optional phrase inside both quotes')!;
  const {p,native}=fixture(language,e.text,e.quotes,e.subjects,{outdoor_seating:true});
  native.choices[0].caution_refs=['feature_family_friendly'];native.choices[0].caution_bindings=[{ref:'feature_family_friendly',criterion:0}];
  const display=renderChoices(validateCoveredDecision(native,p),p)[0];expect(display.coverage?.map(c=>c.state)).toEqual(['unknown','documented']);expect(display.match).toBe('partial');
  expect(display.cautions?.[0].caution_context).toMatchObject({kind:'uncertainty',criterion_indices:[0]});
 });
 it.each(['fr','vi'] as const)('still rejects a real own cooking reference for a family criterion %s',language=>{
  const e=examples.find(e=>e.language===language&&e.name==='optional phrase inside both quotes')!,{p,native}=fixture(language,e.text,e.quotes,e.subjects);
  native.choices[0].criterion_evidence[0].refs.push('reservation_quality_0');
  expect(new Ajv().compile(p.request.text.format.schema)(native)).toBe(true);
  expect(()=>validateCoveredDecision(native,p)).toThrow('INVALID_REFERENCE');
 });
 it.each(['fr','vi'] as const)('two existing canonical refs do not make two different subjects interchangeable %s',language=>{
  const e=examples.find(e=>e.language===language&&e.name==='optional phrase inside both quotes')!,{p,native}=fixture(language,e.text,e.quotes,e.subjects);
  native.choices[0].criterion_evidence[0].refs.push('feature_outdoor_seating');
  expect(new Ajv().compile(p.request.text.format.schema)(native)).toBe(true);
  expect(()=>validateCoveredDecision(native,p)).toThrowError(expect.objectContaining({diagnostic:expect.objectContaining({rule:'reference_not_allowed_for_criterion',criterion_index:0,reference_index:1})}));
 });
 it.each(['fr','vi'] as const)('rejects invented and foreign references, including schema-valid foreign refs %s',language=>{
  const e=examples.find(e=>e.language===language&&e.name==='optional phrase inside both quotes')!,{catalogue,native}=fixture(language,e.text,e.quotes,e.subjects);
  const foreign=recommendationSheet('foreign-proof-owner',{category:'service',positive:'Synthetic service only'});foreign.language=language;foreign.publication!.language=language;
  const p=prepareAi({...catalogue,rows:[...catalogue.rows,foreign],establishments:[...catalogue.establishments,{id:foreign.establishment_id,name:'Synthetic foreign',organization_id:foreign.organization_id}]},query,e.text);
  const validate=new Ajv().compile(p.request.text.format.schema);
  for(const ref of ['invented','strength_service_0']){
   native.choices[0].criterion_evidence[0].refs=[ref];expect(validate(native)).toBe(ref==='strength_service_0');
   expect(()=>validateCoveredDecision(native,p)).toThrow('INVALID_REFERENCE');
  }
 });
 it.each(['fr','vi'] as const)('does not convert unknown source data into a documented property %s',language=>{
  const e=examples.find(e=>e.language===language&&e.name==='optional phrase inside both quotes')!,{p,native}=fixture(language,e.text,e.quotes,e.subjects,{outdoor_seating:true});
  native.choices[0].criterion_evidence[0].state='documented';expect(()=>validateCoveredDecision(native,p)).toThrowError(expect.objectContaining({diagnostic:expect.objectContaining({rule:'state_not_supported_by_facts'})}));
 });
 it.each(['fr','vi'] as const)('keeps family suitability distinct from suitability for children %s',language=>{
  const e=examples.find(e=>e.language===language&&e.name==='children and outdoor seating')!,{p,native}=fixture(language,e.text,e.quotes,e.subjects,{family_friendly:true,outdoor_seating:true});
  const display=renderChoices(validateCoveredDecision(native,p),p)[0];expect(display.coverage?.map(c=>c.state)).toEqual(['unknown','documented']);
  native.choices[0].criterion_evidence[0].refs=['feature_family_friendly'];expect(()=>validateCoveredDecision(native,p)).toThrow('INVALID_REFERENCE');
 });
 it.each(['fr','vi'] as const)('does not erase negation, abstention, temporal or concrete qualifiers %s',language=>{
  const cases=language==='fr'?[
   {text:'Si possible, pas pour les enfants ; une terrasse.',quote:'pour les enfants',subject:'kids'},
   {text:'Je ne cherche pas un lieu pour les enfants.',quote:'pour les enfants',subject:'kids'},
   {text:'Si possible, une terrasse chauffée.',quote:'une terrasse chauffée',subject:'outdoor_seating'},
   {text:'Si possible, une terrasse le week-end.',quote:'une terrasse le week-end',subject:'outdoor_seating'},
   {text:'Si possible, en famille avec des bébés.',quote:'en famille avec des bébés',subject:'family_friendly'},
   {text:'Si possible, un repas en famille avec des enfants.',quote:'en famille avec des enfants',subject:'family_friendly'},
  ]:[
   {text:'Nếu có thể, không muốn trẻ em; ngoài trời.',quote:'trẻ em',subject:'kids'},
   {text:'Không cần một nơi phù hợp với trẻ em.',quote:'trẻ em',subject:'kids'},
   {text:'Nếu có thể, ngoài trời có sưởi.',quote:'ngoài trời có sưởi',subject:'outdoor_seating'},
   {text:'Nếu có thể, ngoài trời cuối tuần.',quote:'ngoài trời cuối tuần',subject:'outdoor_seating'},
   {text:'Nếu có thể, gia đình với trẻ sơ sinh.',quote:'gia đình với trẻ sơ sinh',subject:'family_friendly'},
   {text:'Nếu có thể, gia đình với trẻ em.',quote:'gia đình với trẻ em',subject:'family_friendly'},
  ];
  for(const c of cases){
   const {p,native}=fixture(language,c.text,[c.quote],[c.subject as Feature]);expect(verifiedOpenCriterion(p,native.criteria[0]),c.text).toBeUndefined();
   native.choices[0].criterion_evidence[0].state='unknown';native.choices[0].criterion_evidence[0].refs=[];
   expect(renderChoices(validateCoveredDecision(native,p),p)[0].coverage?.[0].state).toBe('unknown');
   native.choices[0].criterion_evidence[0].state='documented';native.choices[0].criterion_evidence[0].refs=['feature_'+c.subject];expect(()=>validateCoveredDecision(native,p)).toThrow('INVALID_CRITERION_EVIDENCE');
  }
 });
 it.each(['fr','vi'] as const)('binds relevant unknown cautions to each null criterion and rejects swapped bindings %s',language=>{
  const e=examples.find(e=>e.language===language&&e.name==='optional phrase inside both quotes')!,{p,native}=fixture(language,e.text,e.quotes,e.subjects,{});
  native.choices[0].caution_refs=['feature_family_friendly','feature_outdoor_seating'];native.choices[0].caution_bindings=[{ref:'feature_family_friendly',criterion:0},{ref:'feature_outdoor_seating',criterion:1}];
  expect(renderChoices(validateCoveredDecision(native,p),p)[0].cautions?.map(c=>c.caution_context?.criterion_indices)).toEqual([[0],[1]]);
  native.choices[0].caution_bindings[0].criterion=1;expect(()=>validateCoveredDecision(native,p)).toThrow('IRRELEVANT_CAUTION');
 });
 it.each(['fr','vi'] as const)('retains the polarity of a complete negated quote %s',language=>{
  const text=language==='fr'?'Si possible, pas en famille; une terrasse.':'Nếu có thể, không muốn gia đình; ngoài trời.';
  const quotes=language==='fr'?['pas en famille','une terrasse']:['không muốn gia đình','ngoài trời'];
  const {p,native}=fixture(language,text,quotes,['family_friendly','outdoor_seating'],{family_friendly:false,outdoor_seating:true});
  expect(verifiedOpenCriterion(p,native.criteria[0])).toMatchObject({key:'feature_family_friendly',expected:false});
  native.choices[0].criterion_evidence[0].state='documented';expect(renderChoices(validateCoveredDecision(native,p),p)[0].coverage?.map(c=>c.state)).toEqual(['documented','documented']);
 });
 it.each(['fr','vi'] as const)('still accepts two relevant report points for an open mixed report-category need %s',language=>{
  const text=language==='fr'?'Si possible, qualité des plats.':'Nếu có thể, chất lượng món.';
  const {p,native}=fixture(language,text,[text],['family_friendly']);
  native.choices[0].criterion_evidence[0]={criterion:0,state:'partial',refs:['strength_quality_0','reservation_quality_0']};
  native.choices[0].caution_refs=['reservation_quality_0'];native.choices[0].caution_bindings=[{ref:'reservation_quality_0',criterion:0}];
  expect(renderChoices(validateCoveredDecision(native,p),p)[0].coverage?.[0]).toMatchObject({key:null,state:'partial',evidence:[{ref:'strength_quality_0'},{ref:'reservation_quality_0'}]});
 });
});
