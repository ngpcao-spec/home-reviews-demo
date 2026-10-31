// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {recommendationSheet} from '../fixtures/restaurant-recommendation-catalogue';
import {coveredReply} from '../fixtures/recommendation-coverage-reply';
import {placeProfile} from '../../supabase/functions/_shared/google-place-profile';
import {prepareAi,renderChoices,compareAi,RECOMMENDATION_AI_VERSION,type AiPort,type Attempt} from '../../supabase/functions/_shared/recommendation-ai';
import {validateCoveredDecision,restoreCoveredChoices,CRITERIA_VERSION} from '../../supabase/functions/_shared/recommendation-criteria';
import {recommendRestaurants,type SheetRow} from '../../supabase/functions/_shared/restaurant-recommendation-engine-v1';

const query={geography:'not_requested' as const};
type Language='fr'|'vi';
function row(id:string,language:Language,features:Record<string,boolean>={},reservation?:string){
 const r=recommendationSheet(id,{score:'5',category:'service',positive:language==='fr'?'Le personnel accompagne les familles.':'Nhân viên hỗ trợ gia đình.',reservation});r.language=language;r.publication!.language=language;
 r.metadata.google_place_profile={...placeProfile([{cid:'123',language,scrapedAt:'2026-10-28T00:00:00Z',reviews:[],additionalInfo:{Amenities:Object.entries(features).map(([k,v])=>({[k]:v}))}}],{google_id:'123',place_id:null,google_maps_url:'https://www.google.com/maps?cid=123',language}),binding:{establishment_id:id,organization_id:r.organization_id}};
 return r;
}
function catalogue(rows:SheetRow[],language:Language){return {rows,language,organizationId:rows[0].organization_id,establishments:rows.map(r=>({id:r.establishment_id,name:'Fixture '+r.establishment_id,organization_id:r.organization_id}))};}
function family(language:Language){
 const rows=[row('outside',language,{'Outdoor seating':true}),row('family',language,{'Family-friendly':true,'Good for kids':true})],cat=catalogue(rows,language);
 const text=language==='fr'?'Un repas en famille en terrasse.':'Bữa ăn gia đình ở ngoài trời.',p=prepareAi(cat,query,text);
 const native={criteria:[{key:'feature_family_friendly',quote:language==='fr'?'en famille':'gia đình'},{key:'feature_outdoor_seating',quote:language==='fr'?'en terrasse':'ngoài trời'}],choices:[{id:'outside',reason_refs:['feature_outdoor_seating','score_global'],criterion_evidence:[{criterion:0,state:'unknown',refs:['feature_family_friendly']},{criterion:1,state:'documented',refs:['feature_outdoor_seating']}],caution_refs:[],alternative_ids:['family']}]};
 return {rows,cat,text,p,native};
}
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');})));
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});

describe.each(['fr','vi'] as const)('source-bound multi-criterion coverage %s',language=>{
 it('keeps family and outdoor separate, exposes unknown data, and compares the inverse tradeoff',()=>{
  const f=family(language),wire=JSON.parse(f.p.request.input),before=structuredClone(f.rows),selected=validateCoveredDecision(f.native,f.p),display=renderChoices(selected,f.p)[0];
  expect(wire.criterion_hints.map((h:{key:string})=>h.key)).toEqual(['feature_family_friendly','feature_outdoor_seating']);
  expect(wire.candidates.find((x:{id:string})=>x.id==='outside').facts.find((x:{ref:string})=>x.ref==='feature_family_friendly')).toMatchObject({value:{status:'not_documented'},source:'not_documented'});
  expect(display.match).toBe('partial');expect(display.coverage?.map(c=>c.state)).toEqual(['unknown','documented']);
  expect(display.coverage?.[0].evidence[0].sources).toEqual([]);expect(display.coverage?.[1].evidence[0].sources?.[0]).toMatchObject({kind:'google_maps',field:'additionalInfo.Amenities.Outdoor seating',value:true});
  expect(display.alternatives?.[0].proposal.establishment_id).toBe('family');expect(display.alternatives?.[0].coverage.map(c=>c.state)).toEqual(['documented','unknown']);
  expect(display.coverage?.[0].label).not.toBe(display.coverage?.[1].label);
  expect(display.proposal.scores).toEqual(recommendRestaurants(f.rows,f.cat.organizationId,language,query).proposals.find(x=>x.establishment_id==='outside')!.scores);expect(f.rows).toEqual(before);
 });
 it('rejects omission, a combined replacement criterion, invented confirmation, wrong references and a missing tradeoff',()=>{
  for(const kind of ['missing','combined','wrong_quote','confirmation','wrong_ref','score_only','missing_alternative','foreign_alternative','self_alternative','extra_prose']){
   const f=family(language),n=structuredClone(f.native);
   if(kind==='missing'){n.criteria.pop();n.choices[0].criterion_evidence.pop();}
   if(kind==='combined'){n.criteria=[{key:'feature_outdoor_seating',quote:f.text}];n.choices[0].criterion_evidence=[{criterion:0,state:'documented',refs:['feature_outdoor_seating']}];}
   if(kind==='wrong_quote')n.criteria[0].quote=n.criteria[1].quote;
   if(kind==='confirmation')n.choices[0].criterion_evidence[0].state='documented';
   if(kind==='wrong_ref')n.choices[0].criterion_evidence[0].refs=['feature_outdoor_seating'];
   if(kind==='score_only')n.choices[0].criterion_evidence[0].refs=['score_global'];
   if(kind==='missing_alternative')n.choices[0].alternative_ids=[];
   if(kind==='foreign_alternative')n.choices[0].alternative_ids=['outside-access'];
   if(kind==='self_alternative')n.choices[0].alternative_ids=['outside'];
   if(kind==='extra_prose')Object.assign(n.choices[0],{explanation:'Perfect for families'});
   expect(()=>validateCoveredDecision(n,f.p),kind).toThrow();
  }
 });
 it('does not upgrade a preference into an eligibility constraint',()=>{
  const f=family(language);expect(f.p.candidates).toHaveLength(2);expect(f.p.request.input).toContain('optional_text_hint');
  const strict=prepareAi(f.cat,{...query,required_features:['family_friendly']},f.text);expect(strict.candidates.map(x=>x.id)).toEqual(['family']);
  expect(strict.criteriaHints.find(h=>h.key==='feature_family_friendly')?.origin).toBe('mandatory_filter');
  const n=coveredReply(strict,[{id:'family',reason_refs:['feature_family_friendly'],caution_ref:null}]);
  expect(renderChoices(validateCoveredDecision(n,strict),strict)[0].coverage?.find(c=>c.key==='feature_family_friendly')?.requirement).toBe('mandatory_filter');
 });
 it('persists only offsets/references, validates compatible cache and rejects tampered or legacy entries',()=>{
  const f=family(language),stored=validateCoveredDecision(f.native,f.p),serialized=JSON.stringify(stored);
  expect(serialized).not.toContain(f.text);expect(serialized).not.toContain(f.native.criteria[0].quote);expect(stored[0].coverage_version).toBe(CRITERIA_VERSION);
  expect(restoreCoveredChoices(stored,f.p)).toEqual(stored);
  const tampered=structuredClone(stored);tampered[0].criteria_spans![0].start=-1;expect(()=>restoreCoveredChoices(tampered,f.p)).toThrow();
  const altered=structuredClone(stored);altered[0].reason_refs=['invented'];expect(()=>restoreCoveredChoices(altered,f.p)).toThrow();
  expect(()=>restoreCoveredChoices([{id:'outside',reason_refs:['score_global'],caution_ref:null}],f.p)).toThrow();
 });
 it('accepts open-ended criteria without a closed input vocabulary and never accepts invented source prose',()=>{
  const f=family(language),text=language==='fr'?'Un endroit pour un moment contemplatif.':'Một nơi cho khoảnh khắc suy ngẫm.',p=prepareAi(f.cat,query,text);
  expect(JSON.parse(p.request.input).natural_language_request).toBe(text);expect(p.criteriaHints).toEqual([]);
  const n={criteria:[{key:null,quote:text}],choices:[{id:'outside',reason_refs:['score_global'],criterion_evidence:[{criterion:0,state:'unknown',refs:[]}],caution_refs:[],alternative_ids:[]}]};
  expect(renderChoices(validateCoveredDecision(n,p),p)[0].coverage?.[0]).toMatchObject({request_span:{start:0,end:text.length},key:null,state:'unknown',evidence:[]});
  expect(JSON.stringify(renderChoices(validateCoveredDecision(n,p),p))).not.toContain(text);
  n.criteria[0].quote='a made-up request';expect(()=>validateCoveredDecision(n,p)).toThrow('INVALID_CRITERION');
 });
 it('preserves scoped quiet observations as partial, without calling unknown weekends a contradiction',()=>{
  const r=row('scoped',language,{Quiet:true}),text=language==='fr'?'Six avis décrivent un dîner calme en semaine ; les week-ends ne sont pas documentés.':'Sáu khách mô tả bữa tối yên tĩnh ngày thường; cuối tuần chưa được ghi nhận.';
  const point={category:'ambiance',text,evidence_ids:['a'.repeat(64)]};r.report_sections.positive_aspects=[point];(r.publication!.derived.report as Record<string,unknown>).positive_aspects=[point];
  const p=prepareAi(catalogue([r],language),query,language==='fr'?'Un lieu calme.':'Một nơi yên tĩnh.');
  const n=coveredReply(p,[{id:r.establishment_id,reason_refs:['score_global'],caution_ref:null}]);
  const c=renderChoices(validateCoveredDecision(n,p),p)[0].coverage![0];expect(c.state).toBe('partial');expect(c.evidence[0].text).toBe(text);expect(c.evidence[0].text).not.toMatch(/informations contradictoires|thông tin trái chiều/);
 });
 it('supports several open-ended criteria without forcing them into the hint vocabulary or treating a negation as a requirement',()=>{
  const f=family(language),parts=language==='fr'?['Pas forcément un cadre feutré','je viens avec mes petits']:['Không nhất thiết không gian trầm','đi cùng các bé'],text=parts.join('; '),p=prepareAi(f.cat,query,text);
  expect(p.criteriaHints).toEqual([]);
  const n={criteria:parts.map(quote=>({key:null,quote})),choices:[{id:'family',reason_refs:['feature_family_friendly'],criterion_evidence:[{criterion:0,state:'unknown',refs:[]},{criterion:1,state:'documented',refs:['feature_family_friendly']}],caution_refs:[],alternative_ids:[]}]};
  const result=renderChoices(validateCoveredDecision(n,p),p)[0];expect(result.coverage?.map(c=>c.state)).toEqual(['unknown','documented']);expect(result.match).toBe('partial');
  expect(JSON.stringify(result)).not.toContain(parts[0]);expect(JSON.parse(p.request.input).natural_language_request).toBe(text);
 });
 it('requires the avoidance quote to retain its negation rather than changing its intent',()=>{
  const r=row('quiet',language,{'Live music':false}),text=language==='fr'?'Sans musique en direct.':'Không có nhạc sống.',p=prepareAi(catalogue([r],language),query,text);
  const n=coveredReply(p,[{id:r.establishment_id,reason_refs:['feature_live_music'],caution_ref:null}]);
  expect(renderChoices(validateCoveredDecision(n,p),p)[0].coverage?.[0].state).toBe('documented');
  n.criteria[0].quote=language==='fr'?'musique en direct':'nhạc sống';expect(()=>validateCoveredDecision(n,p)).toThrow('INVALID_CRITERION');
 });
});

describe.each(['fr','vi'] as const)('S16 recurrence and useful cautions %s',language=>{
 const cases=language==='fr'?[
  ['Un client trouve le T-bone moins cuit que demandé mais reste satisfait. Un autre le trouve trop gras. Ces remarques différentes ne prouvent pas la répétition du même défaut.','not_established','unknown'],
  ['Cinq avis signalent du poulet insuffisamment cuit lors de visites différentes ; aucune vérification indépendante.','reported_repetition','contradicted'],
  ['Un client signale une cuisson insuffisante.','unknown','unknown']]:[
  ['Một khách thấy T-bone tái hơn yêu cầu nhưng vẫn hài lòng. Khách khác thấy thịt có mỡ; chưa xác nhận cùng một lỗi lặp lại.','not_established','unknown'],
  ['Năm đánh giá phản ánh gà chưa chín kỹ trong các lần ghé khác nhau; chưa có kiểm tra độc lập.','reported_repetition','contradicted'],
  ['Một khách phản ánh thịt chưa chín kỹ.','unknown','unknown']];
 it.each(cases)('distinguishes the actual wording without using reference counts: %s',(text,status,state)=>{
  const r=row('source',language,{},text);(r.report_sections.reservations as {category:string}[])[0].category='quality';(r.publication!.derived.report as {negative_aspects:{category:string}[]}).negative_aspects[0].category='quality';const p=prepareAi(catalogue([r],language),query,language==='fr'?'Aucun problème de cuisson récurrent documenté.':'Tránh vấn đề nấu nướng lặp lại.');
  const fact=p.facts.get(r.establishment_id)!.find(f=>f.ref==='cooking_recurrence');expect(fact?.value).toMatchObject({status,independent_verification:'unknown'});
  const n=coveredReply(p,[{id:r.establishment_id,reason_refs:['score_global'],caution_ref:null}]),display=renderChoices(validateCoveredDecision(n,p),p)[0];
  expect(display.coverage?.[0].state).toBe(state);expect(display.coverage?.[0].evidence[0].sources?.[0]).toMatchObject({kind:'report',text});
 });
 it('never treats absent cooking complaints as proven absence of recurring defects',()=>{
  const r=row('source',language),p=prepareAi(catalogue([r],language),query,language==='fr'?'Aucun problème de cuisson récurrent documenté.':'Tránh vấn đề nấu nướng lặp lại.');
  const n=coveredReply(p,[{id:r.establishment_id,reason_refs:['score_global'],caution_ref:null}]);expect(renderChoices(validateCoveredDecision(n,p),p)[0].coverage?.[0].state).toBe('unknown');
  n.choices[0].criterion_evidence[0].state='documented';expect(()=>validateCoveredDecision(n,p)).toThrow('INVALID_CRITERION_EVIDENCE');
 });
 it('rejects an unrelated denied facility and generic current-report freshness as the chosen caution',()=>{
  const r=row('source',language,{'Live music':false},language==='fr'?'Un client signale une attente.':'Một khách phản ánh chờ lâu.'),p=prepareAi(catalogue([r],language),query,language==='fr'?'Service attentionné.':'Phục vụ chu đáo.');
  for(const ref of ['feature_live_music','freshness']){
   const n=coveredReply(p,[{id:r.establishment_id,reason_refs:['score_global'],caution_ref:ref}]);expect(()=>validateCoveredDecision(n,p)).toThrow('IRRELEVANT_CAUTION');
  }
  const n=coveredReply(p,[{id:r.establishment_id,reason_refs:['score_global'],caution_ref:null}]),s=renderChoices(validateCoveredDecision(n,p),p)[0];
  expect(s.cautions).toEqual([]);expect(s.coverage?.[0].state).toBe('partial');expect(s.coverage?.[0].evidence.some(e=>e.ref==='reservation_service_0')).toBe(true);
  expect(s.other_limits?.some(e=>e.ref==='feature_live_music')).toBe(true);
 });
 it('keeps multiple selected cautions and the remaining saved reservation without substituting or losing a source',()=>{
  const r=row('source',language),texts=language==='fr'?['Un plat froid est signalé.','Deux clients signalent une attente, malgré un personnel apprécié.','Un client souhaiterait plus de place.']:['Có phản ánh món nguội.','Hai khách phản ánh chờ lâu dù khen nhân viên.','Một khách mong có thêm chỗ ngồi.'];
  const points=texts.map((text,index)=>({category:['quality','service','ambiance'][index],text,evidence_ids:[String(index+1).repeat(64)]}));
  r.report_sections.reservations=points;(r.publication!.derived.report as {negative_aspects:unknown[]}).negative_aspects=points;
  const p=prepareAi(catalogue([r],language),query,language==='fr'?'Service attentionné.':'Phục vụ chu đáo.'),n=coveredReply(p,[{id:r.establishment_id,reason_refs:['strength_service_0'],caution_ref:null}]);
  n.choices[0].caution_refs=['reservation_quality_0','reservation_service_1'];const s=renderChoices(validateCoveredDecision(n,p),p)[0];
  expect(s.cautions?.map(c=>c.text)).toEqual(texts.slice(0,2));expect(s.other_limits?.find(e=>e.ref==='reservation_ambiance_2')?.text).toBe(texts[2]);
  expect(s.cautions?.[1].sources?.[0]).toMatchObject({kind:'report',report_id:r.report_id,category:'service',index:1});
 });
 it('lets relevant later source points explain a mixed category rather than forcing its first positive and reservation',()=>{
  const r=row('source',language),positives=(language==='fr'?['Un accueil souriant.','Le personnel adapte ses explications aux besoins du groupe.']:['Đón tiếp niềm nở.','Nhân viên giải thích theo nhu cầu của nhóm.']).map((text,index)=>({category:'service',text,evidence_ids:[String(index+1).repeat(64)]}));
  const negatives=(language==='fr'?['Une attente signalée.','Une commande mal comprise malgré un échange aimable.']:['Có phản ánh chờ lâu.','Đơn gọi bị hiểu nhầm dù trao đổi lịch sự.']).map((text,index)=>({category:'service',text,evidence_ids:[String(index+3).repeat(64)]}));
  r.report_sections.positive_aspects=positives;r.report_sections.reservations=negatives;
  Object.assign(r.publication!.derived.report as object,{positive_aspects:positives,negative_aspects:negatives});
  const p=prepareAi(catalogue([r],language),query,language==='fr'?'Service attentionné.':'Phục vụ chu đáo.'),n=coveredReply(p,[{id:r.establishment_id,reason_refs:['score_service'],caution_ref:null}]);
  n.choices[0].criterion_evidence[0].refs=['strength_service_1','reservation_service_1'];
  const s=renderChoices(validateCoveredDecision(n,p),p)[0];expect(s.coverage?.[0].state).toBe('partial');
  expect(s.coverage?.[0].evidence.map(e=>e.text)).toEqual([positives[1].text,negatives[1].text]);
  expect(s.other_limits?.find(e=>e.ref==='reservation_service_0')?.text).toBe(negatives[0].text);
  n.choices[0].criterion_evidence[0].refs=['strength_service_1'];expect(()=>validateCoveredDecision(n,p)).toThrow('INVALID_CRITERION_EVIDENCE');
 });
});

it('uses a new version/cache while retaining one attempt, receipt reuse and unknown-outcome protections',async()=>{
 const f=family('fr'),records=new Map<string,Attempt>();let seq=0;
 const port:AiPort={reserve:vi.fn(async key=>{const old=records.get(key);if(old)return {...old,owned:false};const a={id:String(++seq),owned:true,state:'dispatched',selection:null,metrics:null};records.set(key,a);return a;}),finish:vi.fn(async(id,state,selection,metrics)=>{Object.assign([...records.values()].find(x=>x.id===id)!,{state,selection,metrics});})};
 const http=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({model:'gpt-6.1-sol',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(f.native)}]}]})));
 const args={catalogue:f.cat,query,preference:f.text,userId:'test',access:['org-a'],port,key:'offline-fixture',http,unchanged:async()=>true};
 expect((await compareAi(args)).status).toBe('completed');expect((await compareAi(args)).status).toBe('cached');expect(http).toHaveBeenCalledTimes(1);expect(JSON.stringify([...records.values()])).not.toContain(f.text);
 expect(RECOMMENDATION_AI_VERSION).toBe('recommendation-ai-criteria-coverage-v5');
 const failed={...args,userId:'another',http:vi.fn<typeof fetch>(async()=>{throw Error('SIMULATED_UNKNOWN');})};
 await compareAi(failed);await compareAi(failed);expect(failed.http).toHaveBeenCalledTimes(1);
});
