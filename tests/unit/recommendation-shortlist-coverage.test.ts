// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {shortlistRestaurants,recommendRestaurants,type Request,type SheetRow} from '../../supabase/functions/_shared/restaurant-recommendation-engine-v1';
import {shortlistPreferences,repeatedCookingConcern} from '../../supabase/functions/_shared/shortlist-preferences';
import {prepareAi,RECOMMENDATION_AI_VERSION} from '../../supabase/functions/_shared/recommendation-ai';
import {placeProfile} from '../../supabase/functions/_shared/google-place-profile';
import {recommendationSheet as sheet} from '../fixtures/restaurant-recommendation-catalogue';
const query:Request={geography:'not_requested'};
const ids=(r:ReturnType<typeof shortlistRestaurants>)=>r.proposals.map(p=>p.establishment_id);
const run=(rows:SheetRow[],text='',request:Request=query)=>shortlistRestaurants(rows,'org-a','vi',request,{text});
function profile(row:SheetRow,features:Record<string,boolean>,extra:Record<string,unknown>={}){
 row.metadata.google_place_profile={...placeProfile([{cid:'123',language:row.language,scrapedAt:'2026-10-28T00:00:00Z',countryCode:'VN',reviews:[],
  additionalInfo:{Atmosphere:Object.entries(features).map(([k,v])=>({[k]:v}))},...extra}],
  {google_id:'123',place_id:null,google_maps_url:'https://www.google.com/maps?cid=123',language:row.language}),
  binding:{establishment_id:row.establishment_id,organization_id:row.organization_id}};
 return row;
}
function rows(){return Array.from({length:30},(_,i)=>sheet('ordinary-'+String(i).padStart(2,'0'),{score:'5',category:'service',positive:'Le personnel accompagne les clients.'}));}
const concern=(text:string)=>repeatedCookingConcern([{report_id:'report',section:'reservations',index:0,category:'quality',text,evidence_ids:['a'.repeat(64)]}]);
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');})));
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});

describe('conservative optional hints, never hard constraints',()=>{
 it.each(['Pas forcément calme.','Je ne souhaite pas un cadre calme.','Je ne recherche pas le calme.',
  'Le calme n’est pas indispensable.','Không cần yên tĩnh.','Yên tĩnh không bắt buộc.',
  'Si le service convient, privilégier le calme.','Nếu phục vụ tốt; yên tĩnh.',
  'Calme en semaine ; week-ends non documentés.'])('keeps uncertainty for negation/conditions: %s',text=>{
  const p=shortlistPreferences(query,text);expect(p.features.find(f=>f.feature==='quiet')).toBeUndefined();expect(p.text_status).not.toBe('absent');
 });
 it.each(['Pas de musique en direct, le calme n’est pas indispensable.',
  'Không cần yên tĩnh, nhưng tôi không muốn có nhạc sống.'])('can distinguish avoiding music from not requiring quiet: %s',text=>{
  const p=shortlistPreferences(query,text);expect(p.features).toEqual([{feature:'live_music',expected:false,source:'text_hint'}]);
 });
 it('suppresses conflicting hints rather than using whichever came first',()=>{
  expect(shortlistPreferences(query,'Musique en direct ; sans musique en direct.').features).toEqual([]);
  expect(shortlistPreferences(query,'Sans musique en direct ; musique en direct.').features).toEqual([]);
 });
 it('does not override a structured preference with uncertain prose or conflate vegan with vegetarian',()=>{
  expect(shortlistPreferences({...query,preferences:{features:['quiet']}},'Pas forcément calme.').features)
   .toEqual([{feature:'quiet',expected:true,source:'structured'}]);
  expect(shortlistPreferences(query,'Thực đơn thuần chay.').features.map(f=>f.feature)).toEqual(['vegan_options']);
 });
 it('does not invent structured prices, dates, cuisines or hard requirements from arbitrary prose',()=>{
  const text='Không có dữ liệu về mọi chi tiết; une soirée insolite, dans mon budget et ouverte tard.';
  const original=structuredClone(query),p=shortlistPreferences(query,text);
  expect(query).toEqual(original);expect(p).not.toHaveProperty('budget');expect(p).not.toHaveProperty('required_features');
  expect(JSON.stringify(p)).not.toContain(text);expect(p.text_status).toBe('uninterpreted');
 });
 it.each(['Aucun problème de cuisson récurrent documenté.','Tôi không muốn có vấn đề nấu nướng lặp lại.'])('recognizes only an optional repeated-cooking concern: %s',text=>{
  expect(shortlistPreferences(query,text).avoidRepeatedCooking).toBe(true);
 });
 it.each(['Je souhaite éviter le bruit.','Tôi muốn tránh tiếng ồn.'])('can use an explicit wish to avoid noise without inferring safety from absent complaints: %s',text=>{
  expect(shortlistPreferences(query,text).features).toContainEqual({feature:'quiet',expected:true,source:'text_hint'});
 });
 it.each(['Je ne souhaite pas éviter le bruit.','Aucun bruit signalé.','Không có phản ánh về tiếng ồn.'])('does not turn ambiguous noise prose into a quiet preference: %s',text=>{
  expect(shortlistPreferences(query,text).features).toEqual([]);
 });
 it.each(['Service non prioritaire.','Le service n’est pas une priorité.','Không ưu tiên phục vụ.'])('does not infer a category preference from a negated priority: %s',text=>{
  expect(shortlistPreferences(query,text).categories).toEqual([]);
 });
 it.each(['Tôi muốn không gian yên tĩnh.','Tôi muốn không khí yên tĩnh.'])('does not mistake Vietnamese space/atmosphere nouns for negation or a conditional: %s',text=>{
  expect(shortlistPreferences(query,text).features).toContainEqual({feature:'quiet',expected:true,source:'text_hint'});
 });
});

describe('reported recurrence is not inferred from counts or a criticism alone',()=>{
 it.each(['Cinq avis signalent du poulet insuffisamment cuit lors de visites différentes ; aucune vérification indépendante.',
  'Năm đánh giá phản ánh gà chưa chín kỹ trong các lần ghé khác nhau; chưa có kiểm tra độc lập.',
  'Des défauts de cuisson récurrents sont signalés ; ils n’ont pas été vérifiés indépendamment.'])('keeps an explicit attributed repetition: %s',text=>{
  expect(concern(text).status).toBe('reported_repetition');
 });
 it.each(['Un plat trop cuit ; les prix sont critiqués de façon répétée.',
  'Một món chưa chín kỹ; giá bị phản ánh lặp lại.',
  'Un client signale une cuisson inégale.',
  'La cuisson a plusieurs références, sans information sur les incidents.'])('does not manufacture recurrence: %s',text=>{
  expect(concern(text).status).toBe('unknown');
 });
 it.each(['Deux défauts de cuisson différents ne prouvent pas la répétition du même défaut.',
  'Un client trouve la cuisson insuffisante ; aucun problème récurrent n’est établi.',
  'Aucune critique de cuisson récurrente signalée.',
  'Pas de problèmes de cuisson répétés.',
  'Un problème de cuisson répété dans trois avis portant sur le même incident.',
  'Một khách thấy T-bone tái hơn yêu cầu nhưng vẫn hài lòng. Khách khác thấy thịt có mỡ; chưa xác nhận cùng một lỗi lặp lại.',
  'Nhiều đánh giá về thịt chưa chín trong cùng một sự cố.'])('preserves unestablished or single-incident qualifications: %s',text=>{
  expect(concern(text).status).toBe('not_established');
 });
});

describe('bounded portfolio using the existing eligibility gate',()=>{
 it('retains the score core and a documented alternative just below the original edge, without changing any score',()=>{
  const input=rows(),alternative=profile(sheet('quiet-alternative',{score:'4.91',category:'service'}),{Quiet:true});input.push(alternative);
  const before=structuredClone(input),baseline=run(input),next=run(input,'Un lieu calme.');
  expect(ids(baseline)).not.toContain(alternative.establishment_id);expect(ids(next)).toContain(alternative.establishment_id);
  expect(ids(next).slice(0,10)).toEqual(ids(baseline).slice(0,10));expect(next.proposals).toHaveLength(20);
  expect(next.shortlist).toMatchObject({eligible_count:31,quality_pool_count:31,quality_margin:'0.10',baseline_core_count:10});
  expect(next.shortlist!.decisions.find(d=>d.establishment_id===alternative.establishment_id)).toMatchObject({reason:'documented_preferences',confirmed:['quiet']});
  const allScores=run([alternative]).proposals[0].scores;
  expect(next.proposals.find(p=>p.establishment_id===alternative.establishment_id)!.scores).toEqual(allScores);expect(input).toEqual(before);
 });
 it('does not promote an otherwise matching alternative outside the existing exact quality margin',()=>{
  const input=rows();input.push(profile(sheet('too-far-below',{score:'4.899999999999999999999'}),{Quiet:true}));
  const next=run(input,'Un lieu calme.');expect(ids(next)).not.toContain('too-far-below');expect(next.shortlist!.quality_pool_count).toBe(30);
 });
 it('handles structured preferences in the same path and leaves the normal three-result ranking intact',()=>{
  const input=rows();input.push(profile(sheet('feature-alternative',{score:'4.95'}),{Quiet:true}));
  const baseline=recommendRestaurants(input,'org-a','vi',query),preferred=run(input,'',{...query,preferences:{features:['quiet'],categories:['service']}});
  expect(ids(preferred)).toContain('feature-alternative');expect(recommendRestaurants(input,'org-a','vi',query)).toEqual(baseline);
 });
 it('does not use absent complaints as confirmation or an unknown feature as a reason for exclusion',()=>{
  const input=rows(),missing=sheet('missing',{score:'4.95',category:'ambiance',reservation:'Aucun bruit signalé.'});input.push(missing);
  const result=run(input,'Un lieu calme.');expect(result.excluded).toEqual([]);
  const selected=result.shortlist!.decisions.filter(d=>d.establishment_id==='missing');
  expect(selected.every(d=>d.unknown.includes('quiet')&&!d.confirmed.includes('quiet'))).toBe(true);
  expect(run([missing],'Un lieu calme.').proposals).toHaveLength(1);
 });
 it('prioritizes an aligned tail over a real noise contradiction and reported repeated cooking without hiding either as ineligible',()=>{
  const input=rows();
  input.push(profile(sheet('z-noise-conflict',{score:'4.99',category:'ambiance',reservation:'La salle est bruyante et la musique forte.'}),{Quiet:true}));
  input.push(profile(sheet('z-cooking-recurrence',{score:'4.99',category:'quality',reservation:'Des défauts de cuisson récurrents sont signalés.'}),{Quiet:true}));
  input.push(profile(sheet('z-aligned',{score:'4.91'}),{Quiet:true}));
  const result=run(input,'Un lieu calme et aucun problème de cuisson récurrent documenté.');
  expect(ids(result)).toContain('z-aligned');expect(ids(result)).not.toContain('z-noise-conflict');expect(ids(result)).not.toContain('z-cooking-recurrence');
  expect(result.excluded).toEqual([]); // Soft tradeoffs are not hard rejections.
  const subset=run(input.slice(-3),'Un lieu calme et aucun problème de cuisson récurrent documenté.');
  expect(subset.proposals).toHaveLength(3);expect(subset.shortlist!.decisions.find(d=>d.establishment_id==='z-noise-conflict')!.warnings).toContain('SOURCE_DISAGREEMENT:quiet');
 });
 it('uses contextual facts at the visit, preserving actual dated contradictions and weekend unknowns',()=>{
  const row=profile(sheet('timed',{category:'ambiance',positive:'Calme en semaine ; les week-ends ne sont pas documentés.'}),{Quiet:true},
   {openingHours:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(day=>({day,hours:'00:00–00:00'}))});
  const monday=run([row],'Un lieu calme.',{...query,visit_at:'2026-11-02T12:00:00Z'}),saturday=run([row],'Un lieu calme.',{...query,visit_at:'2026-10-31T12:00:00Z'});
  expect(monday.shortlist!.decisions[0].confirmed).toContain('quiet');expect(saturday.shortlist!.decisions[0].unknown).toContain('quiet');
  expect(saturday.shortlist!.decisions[0].confirmed).not.toContain('quiet');
 });
 it.each(['fr','vi'])('does not reapply Friday noise to Saturday because an unrelated unknown clause is active (%s)',language=>{
  const row=sheet('scope',{category:'ambiance',positive:language==='fr'?'Le rapport ne confirme pas le calme.':'Báo cáo không xác nhận mức tiếng ồn.',
   reservation:language==='fr'?'La musique est forte le vendredi.':'Nhạc to vào thứ sáu.'});
  row.language=language;row.publication!.language=language;
  profile(row,{Quiet:true},{openingHours:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(day=>({day,hours:'00:00–00:00'}))});
  const result=shortlistRestaurants([row],'org-a',language,{...query,visit_at:'2026-10-31T12:00:00Z'},{text:'Un lieu calme.'});
  expect(result.proposals[0].contradictions).toHaveLength(1);expect(result.shortlist!.decisions[0].warnings).toEqual([]);
 });
 it('keeps budget currency, closed bounds, confirmed per-person unit and cuisine mandatory before every alternative',()=>{
  const input=rows();for(const r of input){(r.metadata.google_metadata as Record<string,unknown>).cuisine_types=['italian'];
   (r.metadata.budget as Record<string,unknown>).establishment_price={source:'google_maps_import',status:'provided',price_range:'100000–200000 VND par personne',observed_at:'2026-10-28T00:00:00Z'};}
  const price=(id:string,range:string)=>{const r=profile(sheet(id),{Quiet:true});(r.metadata.google_metadata as Record<string,unknown>).cuisine_types=['italian'];
   (r.metadata.budget as Record<string,unknown>).establishment_price={source:'google_maps_import',status:'provided',price_range:range,observed_at:'2026-10-28T00:00:00Z'};return r;};
  input.push(price('unit-unknown','100000–200000 VND'),price('usd','10–20 USD per person'),price('open-bound','100000+ VND par personne'),price('expensive','200000–300000 VND par personne'),profile(sheet('wrong-cuisine',{cuisines:['japanese']}),{Quiet:true}));
  const request:Request={...query,cuisines:['italian'],budget:{kind:'amount',currency:'VND',maximum:200000,unit:'per_person'}};
  const old=run(input,'',request),result=run(input,'Calme, sans limite de prix, cuisine japonaise.',request);
  expect(result.excluded).toEqual(old.excluded);expect(result.shortlist!.eligible_count).toBe(30);expect(result.proposals).toHaveLength(20);
  expect(result.proposals.every(p=>p.budget.establishment.unit==='per_person'&&p.budget.establishment.range?.currency==='VND'&&p.budget.establishment.range.maximum<=200000)).toBe(true);
 });
 it('never relaxes geography, closure, organization or language to complete the portfolio',()=>{
  const good=profile(sheet('good'),{Quiet:true});
  const closed=profile(sheet('closed'),{Quiet:true},{permanentlyClosed:true});
  const far=profile(sheet('far',{latitude:15}),{Quiet:true});
  const foreign=sheet('foreign');foreign.organization_id='other';const fr=sheet('fr');fr.language='fr';
  const result=run([good,closed,far,foreign,fr],'Plus loin si nécessaire, même fermé.',{origin:{latitude:12,longitude:109},area:{kind:'radius',metres:1000}});
  expect(ids(result)).toEqual(['good']);expect(JSON.stringify(result)).not.toContain('foreign');
 });
 it.each([0,1,2,6,20])('does not fill or unnecessarily reorder a small eligible set (%s)',count=>{
  const input=rows().slice(0,count);expect(ids(run(input,'Préférence personnalisée inconnue.'))).toEqual(ids(run(input)));expect(run(input,'Calme.').proposals).toHaveLength(count);
 });
 it('is deterministic under reordered input, deduplicates identities and preserves the empty-request order',()=>{
  const input=rows(),first=run(input,'Un cadre calme.');expect(run([...input].reverse(),'Un cadre calme.')).toEqual(first);
  expect(ids(run(input))).toEqual(ids(shortlistRestaurants(input,'org-a','vi',query)));
  const duplicate=run([...input,input[0]],'Un cadre calme.');expect(new Set(ids(duplicate)).size).toBe(duplicate.proposals.length);expect(ids(duplicate)).not.toContain(input[0].establishment_id);
 });
 it('feeds only retained eligible candidates to the existing AI preparation; keeps the full text, model, prompt and response cap',()=>{
  const input=rows();input.push(profile(sheet('alternative',{score:'4.91'}),{Quiet:true}));
  const catalogue={organizationId:'org-a',language:'vi',rows:input,establishments:input.map(r=>({id:r.establishment_id,name:'Fixture',organization_id:'org-a'}))};
  const text='Un lieu calme ; je préfère prendre mon temps.',prepared=prepareAi(catalogue,query,text),plain=prepareAi(catalogue,query,'');
  expect(prepared.candidates.map(c=>c.id)).toEqual(ids(run(input,text)));expect(prepared.candidates.map(c=>c.id)).toContain('alternative');
  const data=JSON.parse(prepared.request.input);expect(data.natural_language_request).toBe(text);expect(data.configuration_version).toBe(RECOMMENDATION_AI_VERSION);
  expect(data).not.toHaveProperty('optional_preference_signals');expect(JSON.stringify(prepared.shortlist)).not.toContain(text);
  expect(prepared.request.instructions).toBe(plain.request.instructions);expect(prepared.request.model).toBe(plain.request.model);expect(prepared.request.max_output_tokens).toBe(plain.request.max_output_tokens);
  expect(prepared.request.text.format.schema.properties.choices.maxItems).toBe(3);expect(prepared.candidates).toHaveLength(20);
 });
});
