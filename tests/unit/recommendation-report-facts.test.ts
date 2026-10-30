// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {recommendationSheet} from '../fixtures/restaurant-recommendation-catalogue';
import {recommendRestaurants} from '../../supabase/functions/_shared/restaurant-recommendation-engine-v1';
import {privateReportText,reportPoint,REPORT_FACTS_VERSION} from '../../supabase/functions/_shared/recommendation-report-facts';
import {prepareAi,renderChoices,validateChoices,compareAi,aiHash,RECOMMENDATION_AI_VERSION,type AiPort,type Attempt} from '../../supabase/functions/_shared/recommendation-ai';
const hashes=['a','b','c'].map(c=>c.repeat(64));
function fixture(text='Un client souhaiterait davantage d’espace, mais reste satisfait.'){
 const row=recommendationSheet('example',{positive:'Les légumes sont appréciés.',reservation:text});
 const point={category:'quality',text,evidence_ids:hashes};row.report_sections.reservations=[point];(row.publication!.derived.report as Record<string,unknown>).negative_aspects=[point];
 row.publication!.source_bindings=[{id:'frozen-a'},{id:'frozen-b'}];
 row.publication!.evidence_bindings=hashes.map((h,i)=>({evidence_id:h,review_id:i===2?'frozen-b':'frozen-a',category:'quality',polarity:'negative'}));
 const catalogue={organizationId:row.organization_id,language:row.language,rows:[row],establishments:[{id:row.establishment_id,name:'Example',organization_id:row.organization_id}]};
 const prepared=prepareAi(catalogue,{geography:'not_requested'},'Éviter le bruit et les défauts de cuisson récurrents.'),p=prepared.proposals[0];
 const note=()=>reportPoint(p,p.reservations[0],row);
 return {row,catalogue,prepared,p,note};
}
describe('versioned useful report excerpts with proven frozen support',()=>{
 it('counts distinct frozen reviews, not references, and never equates this count with recurrence',()=>{
  const f=fixture();expect(f.note()).toMatchObject({distinct_reviews:2,support_scope:'multiple_documented_reviews',recurrence:'unknown',relevance:'not_verified'});
  (f.row.publication!.evidence_bindings as {review_id:string}[])[2].review_id='frozen-a';expect(f.note()).toMatchObject({distinct_reviews:1,support_scope:'one_documented_review',recurrence:'unknown'});
 });
 it('recognizes equivalent database/ISO timestamps without losing proven support counts',()=>{
  const f=fixture();f.row.publication!.generated_at='2026-10-28 00:00:00+00';expect(f.note().distinct_reviews).toBe(2);
 });
 it.each(['missing','ambiguous','category','polarity','foreign_review','fingerprint','report','organization'])('leaves support unknown for %s rather than returning a partial count',scenario=>{
  const f=fixture(),bindings=f.row.publication!.evidence_bindings as Record<string,unknown>[];
  if(scenario==='missing')bindings.pop();if(scenario==='ambiguous')bindings.push({...bindings[0],review_id:'frozen-b'});
  if(scenario==='category')bindings[0].category='service';if(scenario==='polarity')bindings[0].polarity='positive';if(scenario==='foreign_review')bindings[0].review_id='current-not-frozen';
  if(scenario==='fingerprint')f.row.publication!.scope.fingerprint='another';if(scenario==='report')f.row.publication!.report_id='another';if(scenario==='organization')f.row.publication!.organization_id='another';
  expect(f.note()).toMatchObject({distinct_reviews:null,support_scope:'unknown',recurrence:'unknown'});
 });
 it.each(['Un client aimerait davantage d’espace, mais recommande vivement l’endroit.',
  'Un steak est jugé trop saignant, mais le client reste satisfait ; un autre le trouve gras, pas le même défaut répété.',
  'Deux témoignages décrivent une soupe aigre ; un autre évoque une aile peu cuite. La cause d’un malaise rapporté reste inconnue.',
  'Cette information ne permet pas de conclure.'])('preserves the whole text and its nuances without an invented issue label: %s',text=>{
  const f=fixture(text),wire=JSON.parse(f.prepared.request.input).candidates[0].facts.find((x:{ref:string})=>x.ref==='reservation_quality_0');
  expect(wire.value.text).toBe(text);expect(wire.value.recurrence).toBe('unknown');expect(wire.value.source).toEqual({kind:'published_report',report_id:f.row.report_id,section:'reservations',index:0});
 });
 it('redacts introduced names and contacts without deleting a complaint, a negation or favourable nuance',()=>{
  for(const text of ['La serveuse Anne-Sophie était aimable, mais le poulet était froid. Contact: anna@example.com +33 612345678.',
   'Chị Ánh rất tốt nhưng thịt không chín. https://example.invalid @private-person']){
   const safe=privateReportText(text);expect(safe.redacted).toBe(true);expect(safe.text).not.toMatch(/Anne-Sophie|Ánh|anna@|612345678|https:|@private/);expect(safe.text).toMatch(/poulet était froid|thịt không chín/);
  }
 });
 it('does not hide dish names, quantities, prices or qualifications as a semantic shortcut',()=>{
  const text='T-bone medium well demandé, mais client satisfait. Bolognese et Tom Yum appréciés ; 70 000 wons, pas 70 000 VND.';
  expect(privateReportText(text)).toEqual({text,redacted:false});
 });
 it('includes all report categories even with a service preference and renders the exact selected point',()=>{
  const f=fixture(),price={category:'price',text:'Un client juge la valeur correcte, sans tarif indiqué.',evidence_ids:['d'.repeat(64)]};
  (f.row.report_sections.positive_aspects as unknown[]).push(price);(f.row.publication!.derived.report as Record<string,unknown>).positive_aspects=f.row.report_sections.positive_aspects;
  const p=prepareAi(f.catalogue,{geography:'not_requested',preferences:{categories:['service']}},'');
  const choices=validateChoices({choices:[{id:f.row.establishment_id,reason_refs:['strength_price_1'],caution_ref:'reservation_quality_0'}]},p),display=renderChoices(choices,p);
  expect(display[0].reasons[0].text).toBe(price.text);expect(display[0].reasons[0].sources?.[0]).toMatchObject({kind:'report',category:'price',index:1});
 });
 it('keeps score values and deterministic ranking intact while versioning content and compact wire scores',()=>{
  const f=fixture(),before=recommendRestaurants(f.catalogue.rows,f.catalogue.organizationId,'vi',{geography:'not_requested'}),input=JSON.parse(f.prepared.request.input);
  expect(input.configuration_version).toBe('recommendation-ai-report-excerpts-v3');expect(input.content_version).toBe(REPORT_FACTS_VERSION);
  for(const c of ['global','quality','service','ambiance'] as const)expect(input.candidates[0].facts.find((v:{ref:string})=>v.ref==='score_'+c).value).toBe(before.proposals[0].scores[c].value);
  expect(f.p.scores).toEqual(before.proposals[0].scores);expect(f.prepared.request.instructions).toContain('Absence of criticism does not establish quiet');expect(f.prepared.request.instructions).toContain('Price opinions');
 });
 it('never reuses a pre-excerpt cache entry; identical V3 retries reuse the receipt without a second mock call',async()=>{
  const f=fixture(),records=new Map<string,Attempt>();
  const oldKey=await aiHash({version:'recommendation-ai-free-text-reference-selection-v2',requestHash:'before-report-prose'});
  records.set(oldKey,{id:'legacy',owned:false,state:'succeeded',selection:[],metrics:null});
  const port:AiPort={reserve:vi.fn(async key=>{if(records.has(key))return {...records.get(key)!,owned:false};const a={id:'v3',owned:true,state:'dispatched',selection:null,metrics:null};records.set(key,a);return a;}),finish:vi.fn(async(id,state,selection,metrics)=>{Object.assign([...records.values()].find(a=>a.id===id)!,{state,selection,metrics});})};
  const choices=[{id:f.row.establishment_id,reason_refs:['strength_quality_0'],caution_ref:'reservation_quality_0'}];
  const http=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({model:'gpt-6.1-sol',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({choices})}]}]})));
  const args={catalogue:f.catalogue,query:{geography:'not_requested' as const},preference:'',userId:'caller',access:['org-a'],port,key:'fixture',http,unchanged:async()=>true};
  expect((await compareAi(args)).status).toBe('completed');expect((await compareAi(args)).status).toBe('cached');expect(http).toHaveBeenCalledTimes(1);expect(records.get(oldKey)!.id).toBe('legacy');expect(RECOMMENDATION_AI_VERSION).not.toContain('v2');
  expect([...records.values()].find(a=>a.id==='v3')!.metrics).toMatchObject({configuration_version:RECOMMENDATION_AI_VERSION,content_version:REPORT_FACTS_VERSION});
 });
});
