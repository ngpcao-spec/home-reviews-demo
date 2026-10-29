// @vitest-environment node
import {expect,it} from 'vitest';
import {recommendRestaurants,recommendationCuisineOptions,type Request} from '../../supabase/functions/_shared/restaurant-recommendation-engine-v1';
import {recommendationSheet as sheet} from '../fixtures/restaurant-recommendation-catalogue';
const noPosition:Request={geography:'not_requested'};
it('accepts the authorized catalogue without inventing a position or distance, including missing coordinates',()=>{
 const rows=[sheet('a'),sheet('b')];rows[1].metadata.google_metadata={source:'google_maps_import'};
 const r=recommendRestaurants(rows,'org-a','vi',noPosition);
 expect(r.proposals.map(p=>p.establishment_id)).toEqual(['a','b']);
 expect(r.proposals.every(p=>p.distance_metres===null&&p.distance_kind==='not_requested')).toBe(true);
 expect(r.proposals.flatMap(p=>p.reasons).some(r=>r.code==='WITHIN_REQUESTED_AREA')).toBe(false);
 expect(r.refinements.some(r=>r.kind==='closer')).toBe(false);
 expect(()=>recommendRestaurants(rows,'org-a','vi',{} as Request)).toThrow('POSITION_REQUIRED');
 expect(()=>recommendRestaurants(rows,'org-a','vi',{...noPosition,origin:{latitude:1,longitude:1}} as unknown as Request)).toThrow('INVALID_AREA');
});
it('retains score bands, service tie-breaking, dated corpus changes, and price diversity',()=>{
 const rows=[sheet('a',{level:2}),sheet('b',{level:2}),sheet('c',{level:1}),sheet('d',{level:3})];
 expect(recommendRestaurants(rows,'org-a','vi',noPosition).proposals.map(p=>p.establishment_id)).toEqual(['a','c','d']);
 const service=sheet('service',{score:'5.05',category:'service'}),other=sheet('other',{score:'5.1'});
 service.stale=true;service.stale_reason='CORPUS_CHANGED';service.publication!.stale=true;service.publication!.stale_reason='CORPUS_CHANGED';
 const r=recommendRestaurants([other,service],'org-a','vi',{...noPosition,preferences:{categories:['service']}});
 expect(r.proposals[0]).toMatchObject({establishment_id:'service',report:{freshness:'corpus_changed',generated_at:service.report_generated_at}});
});
it('offers only documented cuisines of eligible sheets, without generic or unknown labels',()=>{
 const rows=[sheet('a',{cuisines:['restaurant','indian','italian']}),sheet('b',{cuisines:['invented']})];
 const bad=sheet('c',{cuisines:['japanese'],stale:true});
 expect(recommendationCuisineOptions([...rows,bad],'org-a','vi')).toEqual(['indian','italian']);
});
