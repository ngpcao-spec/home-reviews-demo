// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {placeProfile,parsePlaceHours,scheduledOpening} from '../../supabase/functions/_shared/google-place-profile';
import {placeCategories,placeFeatureLabel} from '../../supabase/functions/_shared/google-place-taxonomy';
import {recommendRestaurants,type Request} from '../../supabase/functions/_shared/restaurant-recommendation-engine-v1';
import {recommendationSheet} from '../fixtures/restaurant-recommendation-catalogue';
const identity={google_id:'123',place_id:'place',google_maps_url:'https://www.google.com/maps?cid=123',language:'vi' as const};
const raw=(extra:Record<string,unknown>={})=>({cid:'123',placeId:'place',language:'vi',scrapedAt:'2026-10-28T14:51:44.560Z',reviews:[],countryCode:'VN',title:'Pizza Italian Fake Name',...extra});
const profile=(extra:Record<string,unknown>={})=>placeProfile([raw(extra)],identity);
function sheet(id:string,extra:Record<string,unknown>={}){const s=recommendationSheet(id);s.metadata.google_place_profile={...profile(extra),binding:{establishment_id:id,organization_id:'org-a'}};return s;}
const request:Request={origin:{latitude:12,longitude:109},area:{kind:'radius',metres:10000}};
const run=(rows:ReturnType<typeof sheet>[],r:Partial<Request>={})=>recommendRestaurants(rows,'org-a','vi',{...request,...r});
describe('curated Google place projection',()=>{
 it('uses all categories, separates cuisines, specialties and usages; generic/name/unknown never imply cuisine',()=>{
  expect(placeCategories(['Nhà hàng ý','Nhà hàng pizza','Quán cà phê','Nhà hàng','nhà hàng ý','Mystery'])).toMatchObject({cuisines:['italian'],specialties:['pizza'],usages:['cafe','restaurant'],unrecognized:['Mystery']});
  expect(profile().categories.cuisines).toEqual([]);
  for(const label of ['Restaurant italien','Italian restaurant','Nhà hàng ý'])expect(placeCategories([label]).cuisines).toEqual(['italian']);
 });
 it('retains false, deduplicates entries, preserves unknowns and refuses conflicting aliases to become true',()=>{
  const p=profile({additionalInfo:{Services:[{'Livraison':false},{'Livraison':false},{'Unknown':true}],Atmosphere:[{Quiet:true},{Calme:false}]}});
  expect(p.attributes.entries).toHaveLength(4);expect(p.attributes.facts.delivery.value).toBe(false);
  expect(p.attributes.facts.quiet).toMatchObject({value:null,status:'conflicted'});expect(p.attributes.facts.vegan_options).toBeUndefined();
  expect(placeFeatureLabel('delivery','fr')).toBe('Livraison');expect(placeFeatureLabel('delivery','vi')).toBe('Giao hàng');
 });
 it('retains source dates, raw non-translated prose, safe links only and no reviews, secondary images or whole payload',()=>{
  const p=profile({ownerDescription:'해변가앞 아름다운조명',description:'English presentation',imageUrl:'https://example.org/main.jpg',imageUrls:['secret'],menu:'https://example.org/menu',reserveTableUrl:'https://example.org/book',tableReservationLinks:[{url:'https://example.org/book'},{url:'javascript:alert(1)'}],peopleAlsoSearch:[{name:'secret'}]});
  expect(p.presentation.owner_description).toMatchObject({translated:false,language:null,kind:'commercial_presentation'});
  expect(p.contacts.reservation_links).toEqual(['https://example.org/book']);expect(p.contacts.menu_contents_known).toBe(false);
  for(const group of [p.identity,p.categories,p.hours,p.attributes,p.popularity,p.presentation,p.contacts])expect(group.observed_at).toBe('2026-10-28T14:51:44.560Z');
  expect(JSON.stringify(p)).not.toContain('secret');expect(p.hours.live).toBe(false);
 });
 it('rejects wrong identity, locale, reviews or invalid date without recovery/recollection',()=>{
  for(const extra of [{cid:'456'},{placeId:'wrong'},{language:'en'}])expect(()=>profile(extra)).toThrow('PLACE_PROFILE_IDENTITY_MISMATCH');
  expect(()=>profile({reviews:[{}]})).toThrow('PLACE_PROFILE_RESULT_INVALID');expect(()=>profile({scrapedAt:'bad'})).toThrow('PLACE_PROFILE_RESULT_INVALID');
 });
});
describe('dated weekly schedules, never a live guarantee',()=>{
 const hours=[{day:'Thứ Sáu',hours:'19:00 to 04:00'},{day:'Thứ Bảy',hours:'19:00 to 02:00'},{day:'Chủ Nhật',hours:'Đóng cửa'}];
 it('handles midnight and previous-day spill, split shifts, closures, locale and unknown hours',()=>{
  expect(parsePlaceHours([{day:'vendredi',hours:'11:00–14:30, 16:30–02:00'}])[0].intervals).toEqual([{start:660,end:870},{start:990,end:1560}]);
  const p=profile({openingHours:hours});
  expect(scheduledOpening(p,'2026-10-30T20:00:00Z')).toBe('scheduled_open'); // Saturday 03:00, from Friday
  expect(scheduledOpening(p,'2026-10-30T22:00:00Z')).toBe('scheduled_closed'); // Saturday 05:00
  expect(scheduledOpening(p,'2026-10-31T18:00:00Z')).toBe('scheduled_open'); // Sunday 01:00
  expect(scheduledOpening(p,'2026-11-01T05:00:00Z')).toBe('scheduled_closed');
  expect(scheduledOpening(profile({countryCode:'US',openingHours:hours}),'2026-10-30T20:00:00Z')).toBe('unknown');
  expect(parsePlaceHours([{day:'Monday',hours:'8pm until late'}])[0].status).toBe('unknown');
  expect(()=>scheduledOpening(p,'2026-10-30T20:00:00')).toThrow('INVALID_VISIT_TIME');
 });
 it('does not confuse kitchen/delivery with venue hours or present live observations as current',()=>{
  const p=profile({openingHours:hours,additionalOpeningHours:{'Nhà bếp':[{day:'Friday',hours:'19:00–22:00'}]},wasOpenAtScrapeTime:true,popularTimesHistogram:{Fr:[{hour:20,occupancyPercent:80},{hour:20,occupancyPercent:80}]}});
  expect(scheduledOpening(p,'2026-10-30T16:00:00Z')).toBe('scheduled_open');
  expect(scheduledOpening(p,'2026-10-30T16:00:00Z','kitchen')).toBe('unknown'); // previous kitchen day absent
  expect(p.popularity.weekly[0].values).toHaveLength(1);expect(p.popularity.relative_to_own_peak).toBe(true);expect(p.popularity.live).toBe(false);
 });
});
describe('internal recommendation practical criteria',()=>{
 it('hard requirements fail for false/missing; soft preferences retain unknown candidates, never alter scores',()=>{
  const yes=sheet('yes',{additionalInfo:{Services:[{Delivery:true}]}}),no=sheet('no',{additionalInfo:{Services:[{Delivery:false}]}}),unknown=sheet('unknown');
  const input=JSON.stringify([yes,no,unknown]);
  expect(run([yes,no,unknown],{required_features:['delivery']}).proposals.map(x=>x.establishment_id)).toEqual(['yes']);
  const r=run([no,unknown,yes],{preferences:{features:['delivery']}});expect(r.proposals).toHaveLength(3);expect(r.proposals[0].establishment_id).toBe('yes');
  expect(r.proposals[0].scores.global.value).toBe('5');expect(JSON.stringify([yes,no,unknown])).toBe(input);
 });
 it('filters cuisines, specialties and usages independently and surfaces report/Google contradictions with both sources',()=>{
  const p=sheet('a',{categories:['Nhà hàng ý','Nhà hàng pizza','Quán cà phê'],additionalInfo:{Atmosphere:[{Quiet:true}]}});
  const q=sheet('b',{categories:['Nhà hàng']});
  expect(run([p,q],{cuisines:['italian'],specialties:['pizza'],usages:['cafe']}).proposals).toHaveLength(1);
  expect(run([p],{cuisines:['pizza']}).proposals).toHaveLength(0);
  const negative=[{category:'ambiance',text:'Không gian ồn ào, nhạc to.',evidence_ids:['b'.repeat(64)]}];
  p.report_sections.reservations=negative;(p.publication!.derived.report as Record<string,unknown>).negative_aspects=negative;
  const r=run([p],{preferences:{features:['quiet']}});expect(r.proposals[0].features.quiet.status).toBe('conflicted');expect(r.proposals[0].contradictions[0].citations).toHaveLength(1);
  expect(run([p],{required_features:['quiet']}).proposals).toHaveLength(0);
 });
 it('requires a date with offset for schedule criteria, never infers calm/availability from popularity or a booking link',()=>{
  const p=sheet('a',{reserveTableUrl:'https://example.org/book',popularTimesHistogram:{Mo:[{hour:12,occupancyPercent:0}]}});
  expect(run([p],{required_features:['reservation']}).proposals).toHaveLength(0);expect(run([p],{visit_at:'2026-11-02T05:00:00Z'}).proposals).toHaveLength(0);
  expect(()=>run([p],{visit_at:'2026-11-02T05:00:00'})).toThrow('INVALID_VISIT_TIME');
  expect(run([p],{preferences:{features:['quiet']}}).proposals[0].features.quiet.status).toBe('not_documented');
 });
});
