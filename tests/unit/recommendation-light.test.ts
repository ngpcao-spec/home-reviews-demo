// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {recommendationSheet} from '../fixtures/restaurant-recommendation-catalogue';
import {prepareDirectAi,prepareDirectAiCached,prepareAi} from '../../supabase/functions/_shared/recommendation-ai';
import type {LightSheetCacheEntry} from '../../supabase/functions/_shared/recommendation-light';
import {restaurantLightSheet,LIGHT_SHEET_VERSION} from '../../supabase/functions/_shared/recommendation-light';
import type {Proposal} from '../../supabase/functions/_shared/restaurant-recommendation-engine-v1';

function fixture(language:'fr'|'vi'='fr'){
 const row=recommendationSheet('light-'+language,{reservation:'Un témoignage isolé : plat froid, malgré un accueil apprécié; répétition inconnue.'});
 row.language=language;row.publication!.language=language;
 const catalogue={rows:[row],language,organizationId:row.organization_id,establishments:[]};
 return {row,catalogue};
}
describe.each(['fr','vi'] as const)('deterministic light sheet %s',language=>{
 it('preserves exact scores, all reservations, names, unknown price and source freshness without detailed wire metadata',()=>{
  const {catalogue}=fixture(language),q={geography:'not_requested' as const},old=prepareAi(catalogue,q,''),p=prepareDirectAi(catalogue,q,''),input=JSON.parse(p.request.input),c=input.candidates[0];
  expect(input.content_version).toBe(LIGHT_SHEET_VERSION);expect(p.proposals).toEqual(old.proposals);expect(p.facts).toEqual(old.facts);
  expect(c.scores).toEqual(Object.fromEntries(Object.entries(p.proposals[0].scores).filter(([k])=>k!=='price').map(([k,v])=>[k,v.value])));
  expect(c.name).toBe(p.proposals[0].name);expect(c.reservations[0]).toMatchObject({text:p.proposals[0].reservations[0].text,reviews:null});
  expect(c.google_price).toEqual({range:null,level:null,unit:null});expect(c.report.freshness).toBe('current');
  expect(c).not.toHaveProperty('sources');expect(c).not.toHaveProperty('facts');expect(JSON.stringify(c)).not.toMatch(/evidence_ids|report_id|numerator|denominator|relevance|independent_verification/);
  expect(c.google_features).toEqual({});expect(c.google_features.kids).toBeUndefined();
 });
 it('keeps the same general sheet across different requests and mutating returned data cannot poison reuse',()=>{
  const {catalogue}=fixture(language),q={geography:'not_requested' as const};
  const a=prepareDirectAi(catalogue,q,'Famille et terrasse'),b=prepareDirectAi(catalogue,q,'Service rapide et plats végétariens');
  expect(JSON.parse(a.request.input).candidates).toEqual(JSON.parse(b.request.input).candidates);
  const row=catalogue.rows[0],build=vi.fn(()=>a.proposals[0]);
  const sheet=restaurantLightSheet(row,language,build);sheet.reservations.length=0;
  expect(restaurantLightSheet(row,language,build).reservations).toHaveLength(1);expect(build).not.toHaveBeenCalled();
 });
 it('invalidates on source content, price, facilities, scores, freshness or language, including edits with unchanged report ID',()=>{
  const {row,catalogue}=fixture(language),p=prepareDirectAi(catalogue,{geography:'not_requested'},'').proposals[0];
  for(const mutate of [(r:typeof row)=>{r.report_id+='new';},(r:typeof row)=>{r.report_sections.extra='changed';},(r:typeof row)=>{r.metadata.budget={new_price:123};},(r:typeof row)=>{r.metadata.google_place_profile={new_facility:true};},(r:typeof row)=>{r.calculation_text+=' ';},(r:typeof row)=>{r.stale=!r.stale;}]){
   const changed=structuredClone(row);mutate(changed);const build=vi.fn(()=>p);restaurantLightSheet(changed,language,build);expect(build).toHaveBeenCalledTimes(1);
   restaurantLightSheet(changed,language,build);expect(build).toHaveBeenCalledTimes(1);
  }
  const build=vi.fn(()=>p);restaurantLightSheet(row,language==='fr'?'vi':'fr',build);expect(build).toHaveBeenCalledOnce();
 });
 it('does not clip long reservations, deduplicates exact text, supplements uncovered report observations',()=>{
  const {row,catalogue}=fixture(language),text='Réserve contextualisée. '.repeat(200);
  const negatives=row.report_sections.reservations as {text:string;category:string;evidence_ids:string[]}[];
  negatives[0].text=text;negatives.push({...negatives[0]});
  const report=row.publication!.derived.report as Record<string,unknown>;report.recommendations=[{category:'quality',observations:[{text:'Une autre observation avec incertitude.',evidence_id:'z'.repeat(64)}]}];
  const c=JSON.parse(prepareDirectAi(catalogue,{geography:'not_requested'},'').request.input).candidates[0];
  expect(c.reservations).toHaveLength(2);expect(c.reservations[0].text).toBe(text.trim());expect(c.reservations[0].refs).toHaveLength(2);expect(c.reservations[0].reviews).toBeNull();expect(c.reservations[1].text).toContain('incertitude');
 });
 it('separates Google declared false, missing, conflicted facilities and scoped review observations',()=>{
  const {row,catalogue}=fixture(language),base=prepareDirectAi(catalogue,{geography:'not_requested'},'').proposals[0];
  const p={...base,practical:{attributes:{facts:{kids:{value:true},wheelchair_entrance:{value:false},quiet:{value:null}}}},features:{kids:{status:'reported',citations:base.reservations,context:{status:'unresolved',scopes:[]}}}} as unknown as Proposal;
  row.report_generated_at+=' ';const c=restaurantLightSheet(row,language,()=>p);
  expect(c.google_features).toEqual({kids:true,wheelchair_entrance:false,quiet:'conflicted'});expect(c.google_features.outdoor_seating).toBeUndefined();expect(c.review_features.kids.context).toEqual({status:'unresolved',scopes:[]});
 });
 it('never accesses a provider to prepare a sheet',()=>{
  const network=vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');});vi.stubGlobal('fetch',network);
  try{const {catalogue}=fixture(language);prepareDirectAi(catalogue,{geography:'not_requested'},'');expect(network).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();}
 });
 it('reuses persisted sheets across requests, invalidates changed sources and rejects foreign cache scope',async()=>{
  const {catalogue,row}=fixture(language),records:LightSheetCacheEntry[]=[],save=vi.fn(async(entries:LightSheetCacheEntry[])=>{records.splice(0,records.length,...structuredClone(entries));});
  const port={load:vi.fn(async()=>structuredClone(records)),save},q={geography:'not_requested' as const};
  const first=await prepareDirectAiCached(catalogue,q,'Première demande',port);
  expect(save).toHaveBeenCalledOnce();expect(records[0].source_sha256).toMatch(/^[a-f0-9]{64}$/);
  const second=await prepareDirectAiCached(catalogue,q,'Autre demande',port);expect(save).toHaveBeenCalledOnce();
  expect(JSON.parse(second.request.input).candidates).toEqual(JSON.parse(first.request.input).candidates);
  row.stale=true;row.stale_reason='CORPUS_CHANGED';await prepareDirectAiCached(catalogue,q,'',port);expect(save).toHaveBeenCalledTimes(2);
  expect(records[0].sheet.report.freshness).toBe('corpus_changed');
  records[0].organization_id='foreign';await prepareDirectAiCached(catalogue,q,'',port);expect(save).toHaveBeenCalledTimes(3);
  records[0].language=language==='fr'?'vi':'fr';await prepareDirectAiCached(catalogue,q,'',port);expect(save).toHaveBeenCalledTimes(4);
  records[0].format_version='old';await prepareDirectAiCached(catalogue,q,'',port);expect(save).toHaveBeenCalledTimes(5);
 });
 it('cache read/write failures only rebuild deterministic content without a provider',async()=>{
  const {catalogue}=fixture(language),q={geography:'not_requested' as const},port={load:async()=>{throw Error('offline');},save:async()=>{throw Error('offline');}};
  expect((await prepareDirectAiCached(catalogue,q,'',port)).request).toEqual(prepareDirectAi(catalogue,q,'').request);
 });
});
