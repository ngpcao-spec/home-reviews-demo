// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {placePriceInput,placePriceObservation,placePriceProvider,processPlacePrice,type PriceJob} from '../../supabase/functions/_shared/google-place-price';
import {prices,recommendRestaurants} from '../../supabase/functions/_shared/restaurant-recommendation-engine-v1';
import {recommendationSheet} from '../fixtures/restaurant-recommendation-catalogue';

const identity={google_id:'123',place_id:'place',google_maps_url:'https://www.google.com/maps?cid=123',language:'vi' as const};
const item={cid:'123',placeId:'place',language:'vi',scrapedAt:'2026-10-28T14:51:44.560Z',price:'100-200\u00a0N\u00a0₫',reviews:[]};
const job:PriceJob={...identity,id:'job',run_id:null,dataset_id:null,start_attempted_at:null,request_input:null};
const run={id:'run',dataset_id:'dataset',status:'SUCCEEDED',receipt:{id:'run',status:'SUCCEEDED',usageTotalUsd:0.005}};
function harness(overrides:Partial<PriceJob>={}) {
 const action=vi.fn(async()=>true),provider={start:vi.fn(async()=>run),run:vi.fn(async()=>run),dataset:vi.fn(async()=>[item])};
 return {action,provider,execute:()=>processPlacePrice({...job,...overrides},{action,provider})};
}
it('one exact place, frozen VI/FR language, zero reviews/images/AI/contacts and no broad search',()=>{
 const input=placePriceInput(identity);expect(input).toMatchObject({maxReviews:0,maxImages:0,maxCrawledPlacesPerSearch:1,language:'vi',enableCompetitorAnalysis:false,scrapeContacts:false});
 expect(input.startUrls).toEqual([{url:identity.google_maps_url}]);expect(input).not.toHaveProperty('searchStringsArray');
 expect(placePriceInput({...identity,language:'fr'}).language).toBe('fr');
 for(const url of ['https://example.com/maps?cid=123','https://www.google.com/maps?cid=456','https://www.google.com/maps/search?q=restaurant'])
  expect(()=>placePriceInput({...identity,google_maps_url:url})).toThrow();
});
it('normalizes the received Vietnamese range without inventing a level or per-person unit and drops non-price content',()=>{
 const ob=placePriceObservation([{...item,ownerUpdates:['prose'],updatesFromCustomers:{text:'prose'},imageUrls:['image']}],identity);
 expect(ob.normalized_range).toEqual({status:'parsed',currency:'VND',minimum:100000,maximum:200000,bounds:'closed'});
 expect(ob.unit).toBeNull();expect(ob.raw).not.toHaveProperty('priceLevel');expect(JSON.stringify(ob)).not.toMatch(/prose|imageUrls|ownerUpdates/);
 expect(placePriceObservation([{...item,price:'100-200 N ₫ par personne'}],identity).unit).toBe('per_person');
 expect(placePriceObservation([{...item,price:null}],identity).normalized_range.status).toBe('unparsed');
});
it.each([{...item,cid:'456'},{...item,placeId:'other'},{...item,language:'fr'},{...item,reviews:[{text:'forbidden'}]},{...item,scrapedAt:'not a date'}])('rejects incompatible identity, language, reviews or missing observation date before storage',bad=>expect(()=>placePriceObservation([bad],identity)).toThrow());
it('reserves before its single POST and saves run binding, receipt and minimal observation before completion',async()=>{
 const h=harness();expect(await h.execute()).toBe('finished');expect(h.provider.start).toHaveBeenCalledTimes(1);
 expect(h.action.mock.calls.map(c=>c[0])).toEqual(['reserve','run','run','finish']);
 expect(h.action.mock.calls.at(-1)?.[1]).toMatchObject({observation:{raw:{price:item.price}},receipt:{usageTotalUsd:0.005}});
});
it('does not send a duplicate when reservation is refused or the start outcome is unknown',async()=>{
 const a=harness();a.action.mockResolvedValueOnce(false);await a.execute();expect(a.provider.start).not.toHaveBeenCalled();
 const b=harness({start_attempted_at:'2026-10-28'});await b.execute();expect(b.provider.start).not.toHaveBeenCalled();expect(b.action).toHaveBeenCalledWith('fail',{code:'PLACE_PRICE_OUTCOME_UNKNOWN'});
 const c=harness();c.provider.start.mockRejectedValueOnce(Error('network timeout'));await c.execute();expect(c.provider.start).toHaveBeenCalledTimes(1);expect(c.action).toHaveBeenLastCalledWith('fail',{code:'PLACE_PRICE_OUTCOME_UNKNOWN'});
});
it('continues a known run with GET only and stops a real provider failure without retries',async()=>{
 const a=harness({run_id:'run',dataset_id:'dataset',start_attempted_at:'2026-10-28'});expect(await a.execute()).toBe('finished');expect(a.provider.start).not.toHaveBeenCalled();
 const b=harness();b.provider.run.mockResolvedValueOnce({...run,status:'FAILED'});expect(await b.execute()).toBe('failed');expect(b.provider.dataset).not.toHaveBeenCalled();expect(b.provider.start).toHaveBeenCalledTimes(1);
 const c=harness();c.provider.run.mockResolvedValue({...run,status:'RUNNING'});expect(await c.execute()).toBe('pending');expect(c.provider.run).toHaveBeenCalledTimes(2);expect(c.action).toHaveBeenLastCalledWith('defer',{});
});
it('single raw HTTP start pins the tested actor build and has no SDK retry or redirect',async()=>{
 const network=vi.fn(async()=>new Response('unavailable',{status:503}));const p=placePriceProvider('server-only-test-token',network);
 await expect(p.start(placePriceInput(identity))).rejects.toThrow('PLACE_PRICE_HTTP_503');expect(network).toHaveBeenCalledTimes(1);
 expect(network.mock.calls[0][0]).toContain('compass~crawler-google-places/runs?build=0.14.777');
 expect(network.mock.calls[0][1]).toMatchObject({method:'POST',redirect:'error'});
});
it('uses saved place price in budget filtering, remains indicative, localizes missing values and never calls a provider',()=>{
 const network=vi.fn(()=>{throw Error('NETWORK_FORBIDDEN')});vi.stubGlobal('fetch',network);
 try{
 const saved={establishment_price:{source:'google_maps_place_details',status:'provided',observed_at:item.scrapedAt,price:item.price,unit:'per_person'},customer_spend_per_person:{ranges:[]}};
 const p=prices({budget:saved},'vi');expect(p.establishment).toMatchObject({status:'known',unit:'per_person',guaranteed_tariff:false,range:{currency:'VND',minimum:100000,maximum:200000}});
 expect(prices({},'fr').establishment.label).toBe('Prix non renseigné');expect(prices({},'vi').establishment.label).toBe('Chưa có thông tin giá');
 const row=recommendationSheet('a');row.metadata.budget=saved;
 const request={origin:{latitude:12,longitude:109},area:{kind:'radius' as const,metres:3000}};
 expect(recommendRestaurants([row],'org-a','vi',{...request,budget:{kind:'amount',currency:'VND',maximum:250000}}).proposals).toHaveLength(1);
 expect(recommendRestaurants([row],'org-a','vi',{...request,budget:{kind:'amount',currency:'VND',maximum:150000}}).proposals).toHaveLength(0);
 expect(network).not.toHaveBeenCalled();
 }finally{vi.unstubAllGlobals();}
});
