// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {recommendationSheet} from '../fixtures/restaurant-recommendation-catalogue';
import {placeProfile} from '../../supabase/functions/_shared/google-place-profile';
import {prepareAi,renderChoices} from '../../supabase/functions/_shared/recommendation-ai';
import {CRITERIA_VERSION,restoreCoveredChoices,validateCoveredDecision,verifiedOpenCriterion} from '../../supabase/functions/_shared/recommendation-criteria';
import type {SheetRow} from '../../supabase/functions/_shared/restaurant-recommendation-engine-v1';

type Language='fr'|'vi';
const query={geography:'not_requested' as const};
function sheet(language:Language,features:Record<string,boolean>){
 const r=recommendationSheet('proof-owner',{score:'5',category:'service',positive:language==='fr'?'Accueil attentionné.':'Đón tiếp chu đáo.'});
 r.language=language;r.publication!.language=language;
 r.metadata.google_place_profile={...placeProfile([{cid:'123',language,scrapedAt:'2026-10-28T00:00:00Z',reviews:[],additionalInfo:{Amenities:Object.entries(features).map(([k,v])=>({[k]:v}))}}],{google_id:'123',place_id:null,google_maps_url:'https://www.google.com/maps?cid=123',language}),binding:{establishment_id:r.establishment_id,organization_id:r.organization_id}};
 const negative=[{category:'quality',text:language==='fr'?'Un plat froid, malgré un accueil apprécié.':'Món nguội dù đón tiếp chu đáo.',evidence_ids:['b'.repeat(64)]}];
 r.report_sections.reservations=negative;(r.publication!.derived.report as {negative_aspects:unknown[]}).negative_aspects=negative;
 return r;
}
function prep(r:SheetRow,text:string){return prepareAi({rows:[r],language:r.language,organizationId:r.organization_id,establishments:[{id:r.establishment_id,name:'Synthetic',organization_id:r.organization_id}]},query,text);}
function family(language:Language,features:Record<string,boolean>={'Family-friendly':false,'Outdoor seating':false}){
 const r=sheet(language,features),text=language==='fr'?'Si possible, un repas en famille et en terrasse.':'Nếu có thể, dùng bữa với gia đình ở ngoài trời.',quotes=language==='fr'?['en famille','en terrasse']:['gia đình','ngoài trời'],p=prep(r,text);
 const native={criteria:quotes.map(quote=>({key:null,quote})),choices:[{id:r.establishment_id,reason_refs:['score_global'],criterion_evidence:['family_friendly','outdoor_seating'].map((feature,criterion)=>({criterion,state:features[feature==='family_friendly'?'Family-friendly':'Outdoor seating']===undefined?'unknown':features[feature==='family_friendly'?'Family-friendly':'Outdoor seating']?'documented':'contradicted',refs:['feature_'+feature]})),caution_refs:['feature_family_friendly','feature_outdoor_seating'],caution_bindings:[{ref:'feature_family_friendly',criterion:0},{ref:'feature_outdoor_seating',criterion:1}],alternative_ids:[]}]};
 return {r,text,p,native};
}
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');})));
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});

describe.each(['fr','vi'] as const)('independently source-bound open criteria %s',language=>{
 it('reproduces a general reason for null keys without reconstructing the historical request',()=>{
  const f=family(language);expect(f.p.criteriaHints).toEqual([]);
  expect(JSON.parse(f.p.request.input).natural_language_request).toBe(f.text);
  expect(f.native.criteria.map(c=>verifiedOpenCriterion(f.p,c)?.key)).toEqual(['feature_family_friendly','feature_outdoor_seating']);
  expect(f.p.request.text.format.schema.properties.choices.items.required).toContain('caution_bindings');
 });
 it('keeps two null keys distinct and verifies each explicit binding independently',()=>{
  const f=family(language),choices=validateCoveredDecision(f.native,f.p),r=renderChoices(choices,f.p)[0];
  expect(r.coverage?.map(c=>c.key)).toEqual([null,null]);expect(r.coverage?.map(c=>c.state)).toEqual(['contradicted','contradicted']);
  expect(r.cautions?.map(c=>c.caution_context?.criterion_indices)).toEqual([[0],[1]]);
  expect(r.cautions?.every(c=>c.caution_context?.kind==='documented_issue')).toBe(true);
  expect(restoreCoveredChoices(choices,f.p)).toEqual(choices);
  expect(JSON.stringify(choices)).not.toContain(f.native.criteria[0].quote);
 });
 it('does not accept a real cooking complaint as a family/outdoor caution',()=>{
  const f=family(language);f.native.choices[0].caution_refs=['reservation_quality_0'];f.native.choices[0].caution_bindings=[{ref:'reservation_quality_0',criterion:0}];
  expect(()=>validateCoveredDecision(f.native,f.p)).toThrow('IRRELEVANT_CAUTION');
 });
 it('rejects a declared binding to the wrong one of the two null criteria',()=>{
  const f=family(language);f.native.choices[0].caution_bindings[0].criterion=1;
  expect(()=>validateCoveredDecision(f.native,f.p)).toThrow('IRRELEVANT_CAUTION');
 });
 it('does not treat model-selected evidence as proof of an unrelated subject',()=>{
  const f=family(language);f.native.choices[0].criterion_evidence[0].refs=['reservation_quality_0'];
  expect(()=>validateCoveredDecision(f.native,f.p)).toThrow('INVALID_REFERENCE');
 });
 it('keeps unknown family information explicit rather than treating it as a negative finding',()=>{
  const f=family(language,{'Outdoor seating':false}),r=renderChoices(validateCoveredDecision(f.native,f.p),f.p)[0];
  expect(f.p.candidates[0].unknown_feature_refs).toContain('feature_family_friendly');
  expect(r.coverage?.[0]).toMatchObject({key:null,state:'unknown'});expect(r.cautions?.[0].caution_context).toMatchObject({kind:'uncertainty',criterion_indices:[0]});expect(r.match).toBe('partial');
 });
 it('allows an honestly unknown open feature with no evidence but cannot use that to smuggle in a caution',()=>{
  const f=family(language,{'Outdoor seating':false});f.native.choices[0].criterion_evidence[0].refs=[];f.native.choices[0].caution_refs=['feature_outdoor_seating'];f.native.choices[0].caution_bindings=[{ref:'feature_outdoor_seating',criterion:1}];
  expect(renderChoices(validateCoveredDecision(f.native,f.p),f.p)[0].coverage?.[0]).toMatchObject({state:'unknown',evidence:[]});
  f.native.choices[0].caution_refs=['reservation_quality_0'];f.native.choices[0].caution_bindings=[{ref:'reservation_quality_0',criterion:0}];expect(()=>validateCoveredDecision(f.native,f.p)).toThrow('IRRELEVANT_CAUTION');
 });
 it('rejects fabricated refs and refs that exist only for another candidate',()=>{
  const f=family(language),foreign={...f.p.facts.get('proof-owner')!.find(x=>x.ref==='reservation_quality_0')!,ref:'reservation_service_7'};
  f.p.facts.set('other-owner',[foreign]);
  for(const ref of ['invented','reservation_service_7']){f.native.choices[0].caution_refs=[ref];f.native.choices[0].caution_bindings=[{ref,criterion:0}];expect(()=>validateCoveredDecision(f.native,f.p)).toThrow('INVALID_REFERENCE');}
 });
 it('requires a well-formed binding for each caution and refuses implicit null-key links',()=>{
  const f=family(language),missing=structuredClone(f.native) as unknown as {criteria:unknown[];choices:Record<string,unknown>[]};delete missing.choices[0].caution_bindings;
  expect(()=>validateCoveredDecision(missing,f.p)).toThrow('IRRELEVANT_CAUTION');
  const invalid=structuredClone(f.native);invalid.choices[0].caution_bindings[0].criterion=7;expect(()=>validateCoveredDecision(invalid,f.p)).toThrow('IRRELEVANT_CAUTION');
  const other=structuredClone(f.native);other.choices[0].caution_bindings.reverse();expect(()=>validateCoveredDecision(other,f.p)).toThrow('IRRELEVANT_CAUTION');
 });
 it('does not turn unverified semantics into a positive or negative conclusion',()=>{
  const r=sheet(language,{}),text=language==='fr'?'Un moment propice à la contemplation.':'Một khoảnh khắc phù hợp để suy ngẫm.',p=prep(r,text);
  const native={criteria:[{key:null,quote:text}],choices:[{id:r.establishment_id,reason_refs:['score_global'],criterion_evidence:[{criterion:0,state:'unknown',refs:[] as string[]}],caution_refs:[],caution_bindings:[],alternative_ids:[]}]};
  expect(renderChoices(validateCoveredDecision(native,p),p)[0].coverage?.[0].state).toBe('unknown');
  native.choices[0].criterion_evidence[0].state='documented';native.choices[0].criterion_evidence[0].refs=['strength_service_0'];expect(()=>validateCoveredDecision(native,p)).toThrow('INVALID_CRITERION_EVIDENCE');
 });
 it('does not erase an unproved qualifier merely because a generic feature exists',()=>{
  const r=sheet(language,{'Outdoor seating':true,'Family-friendly':true});
  for(const text of language==='fr'?['Si possible, une terrasse chauffée.','Si possible, en famille avec des bébés.']:['Nếu có thể, ngoài trời có sưởi.','Nếu có thể, gia đình với trẻ sơ sinh.']){
   const p=prep(r,text),quote=text.replace(/^(?:Si possible, |Nếu có thể, )/,'').replace(/\.$/,'');expect(verifiedOpenCriterion(p,{key:null,quote})).toBeUndefined();
  }
 });
 it('can verify exterior/family canonical wording without changing the original conservative shortlist hints',()=>{
  const r=sheet(language,{'Outdoor seating':false}),text=language==='fr'?"Si possible, à l'extérieur.":'Nếu có thể, ngoài trời.',quote=language==='fr'?"à l'extérieur":'ngoài trời',p=prep(r,text);
  expect(p.criteriaHints).toEqual([]);expect(verifiedOpenCriterion(p,{key:null,quote})?.key).toBe('feature_outdoor_seating');
 });
 it('preserves negation context even when the model quotes only a positive noun phrase',()=>{
  const f=family(language);f.p=prep(f.r,language==='fr'?'Si possible, pas en famille, mais en terrasse.':'Nếu có thể, không muốn gia đình, nhưng ngoài trời.');
  expect(verifiedOpenCriterion(f.p,f.native.criteria[0])).toBeUndefined();expect(()=>validateCoveredDecision(f.native,f.p)).toThrow('INVALID_CRITERION_EVIDENCE');
 });
 it('does not infer an unrestricted match from a specific unverified visit time',()=>{
  const r=sheet(language,{Quiet:true}),text=language==='fr'?'Si possible, calme le week-end.':'Nếu có thể, yên tĩnh cuối tuần.',p=prep(r,text),quote=language==='fr'?'calme le week-end':'yên tĩnh cuối tuần';
  expect(verifiedOpenCriterion(p,{key:null,quote})).toBeUndefined();
  const native={criteria:[{key:null,quote}],choices:[{id:r.establishment_id,reason_refs:['score_global'],criterion_evidence:[{criterion:0,state:'unknown',refs:[]}],caution_refs:[],caution_bindings:[],alternative_ids:[]}]};
  expect(renderChoices(validateCoveredDecision(native,p),p)[0].coverage?.[0].state).toBe('unknown');
 });
 it('accepts a relevant scoped report point only through its exact canonical feature provenance',()=>{
  const r=sheet(language,{Quiet:true}),point={category:'ambiance',text:language==='fr'?'Calme en semaine ; week-ends non documentés.':'Yên tĩnh ngày thường; cuối tuần chưa được ghi nhận.',evidence_ids:['a'.repeat(64)]};
  r.report_sections.positive_aspects=[point];(r.publication!.derived.report as {positive_aspects:unknown[]}).positive_aspects=[point];
  const text=language==='fr'?'Si possible, un lieu calme.':'Nếu có thể, một nơi yên tĩnh.',p=prep(r,text),native={criteria:[{key:null,quote:language==='fr'?'calme':'yên tĩnh'}],choices:[{id:r.establishment_id,reason_refs:['score_global'],criterion_evidence:[{criterion:0,state:'partial',refs:['feature_quiet']}],caution_refs:['strength_ambiance_0'],caution_bindings:[{ref:'strength_ambiance_0',criterion:0}],alternative_ids:[]}]};
  const display=renderChoices(validateCoveredDecision(native,p),p)[0];expect(display.cautions?.[0].text).toBe(point.text);expect(display.cautions?.[0].caution_context).toMatchObject({kind:'context_limit',criterion_indices:[0]});expect(display.coverage?.[0].state).toBe('partial');
  native.choices[0].caution_refs=['reservation_quality_0'];native.choices[0].caution_bindings=[{ref:'reservation_quality_0',criterion:0}];expect(()=>validateCoveredDecision(native,p)).toThrow('IRRELEVANT_CAUTION');
 });
 it('rejects old cache coverage rather than silently promoting it to the new protocol',()=>{
  const f=family(language),choices=validateCoveredDecision(f.native,f.p);expect(CRITERIA_VERSION).toBe('recommendation-criteria-coverage-v2');
  const incomplete=structuredClone(choices);delete incomplete[0].caution_bindings;expect(()=>restoreCoveredChoices(incomplete,f.p)).toThrow('CACHE_INCOMPATIBLE');
  choices[0].coverage_version='recommendation-criteria-coverage-v1' as typeof CRITERIA_VERSION;expect(()=>restoreCoveredChoices(choices,f.p)).toThrow('CACHE_INCOMPATIBLE');
 });
});
