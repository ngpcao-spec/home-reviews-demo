// @vitest-environment node
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {recommendationSheet} from '../fixtures/restaurant-recommendation-catalogue';
import {placeProfile} from '../../supabase/functions/_shared/google-place-profile';
import {describeRecommendationFallback} from '../../supabase/functions/_shared/recommendation-ai';
import {recommendRestaurants,type Request} from '../../supabase/functions/_shared/restaurant-recommendation-engine-v1';
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');})));
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});
describe.each(['fr','vi'] as const)('general fallback disclosure %s',language=>{
 it('keeps Friday noise scoped, preserves ranking and scores, and never confirms the whole request',()=>{
  const text=language==='fr'?'La musique est forte le vendredi.':'Nhạc to vào thứ sáu.',row=recommendationSheet('weekly-noise',{category:'ambiance',positive:language==='fr'?'La décoration est appréciée.':'Trang trí được khen.',reservation:text});row.language=language;row.publication!.language=language;
  row.metadata.google_place_profile={...placeProfile([{cid:'123',language,countryCode:'VN',scrapedAt:'2026-10-28',reviews:[],openingHours:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(day=>({day,hours:'00:00–00:00'})),additionalInfo:{Atmosphere:[{Quiet:true}]}}],{google_id:'123',place_id:null,google_maps_url:'https://www.google.com/maps?cid=123',language}),binding:{establishment_id:row.establishment_id,organization_id:row.organization_id}};
  const before=structuredClone(row),catalogue={rows:[row],organizationId:row.organization_id,language,establishments:[]},request=language==='fr'?'Un dîner calme.':'Bữa tối yên tĩnh.';
  for(const visit_at of [undefined,'2026-10-30T12:00:00Z','2026-11-02T12:00:00Z']){
   const q:Request={geography:'not_requested',...(visit_at?{visit_at}:{})},result=recommendRestaurants([row],row.organization_id,language,q),r=describeRecommendationFallback(catalogue,q,request,result.proposals);
   expect(result.proposals).toHaveLength(1);expect(r.personalized_choice_available).toBe(false);expect(r.free_text).toBe('not_verified');expect(r.verified.geography).toBe('not_requested');
   const c=r.assessments[0].coverage.find(c=>c.key==='feature_quiet')!;
   if(!visit_at){expect(c.state).toBe('partial');expect(c.evidence.flatMap(x=>x.sources??[]).some(s=>s.kind==='report'&&s.text===text)).toBe(true);}
   else expect(c.state).toBe(visit_at.includes('10-30')?'conflicted':'documented');
   expect(result.proposals[0].scores.global.value).toBe('5');
  }
  expect(row).toEqual(before);
 });
 it('does not invent an interpretation for free text outside conservative hints',()=>{
  const row=recommendationSheet('unknown');row.language=language;row.publication!.language=language;
  const q={geography:'not_requested' as const},catalogue={rows:[row],organizationId:row.organization_id,language,establishments:[]},result=recommendRestaurants([row],row.organization_id,language,q);
  const r=describeRecommendationFallback(catalogue,q,language==='fr'?'Un moment contemplatif.':'Khoảnh khắc suy ngẫm.',result.proposals);
  expect(r.personalized_choice_available).toBe(false);expect(r.assessments[0].coverage).toEqual([]);expect(r.verified.budget).toBeNull();expect(r.verified.required_features).toEqual([]);
 });
});
