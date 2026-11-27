// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {placePriceInput,placePriceObservation,placePriceProvider,processPlacePrice,type PriceJob} from '../../supabase/functions/_shared/google-place-price';
import {prices,recommendRestaurants} from '../../supabase/functions/_shared/restaurant-recommendation-engine-v1';
import {recommendationSheet} from '../fixtures/restaurant-recommendation-catalogue';

const identity={google_id:'123',place_id:'place',google_maps_url:'https://www.google.com/maps?cid=123',language:'vi' as const};
const item={cid:'123',placeId:'place',language:'vi',scrapedAt:'2026-10-28T14:51:44.560Z',price:'100-200\u00a0N\u00a0₫',reviews:[]};
const job:PriceJob={...identity,id:'job',run_id:null,dataset_id:null,start_attempted_at:null,request_input:null};
const build={id:'currentBuild',actId:'nwua9Gu5YrADL7ZDj',buildNumber:'0.14.797',status:'SUCCEEDED'};
const actor={id:build.actId,pricingInfos:[{startedAt:'2026-01-01',pricingModel:'PAY_PER_EVENT',minimalMaxTotalChargeUsd:0.5}]};
const preflight={actor_id:build.actId,build_number:build.buildNumber,build_id:build.id,minimum_max_total_charge_usd:0.5,
 max_total_charge_usd:0.5,checked_at:'2026-11-27T05:45:00Z'};
const run={id:'run',dataset_id:'dataset',status:'SUCCEEDED',receipt:{id:'run',status:'SUCCEEDED',buildId:build.id,usageTotalUsd:0.005}};
function harness(overrides:Partial<PriceJob>={}) {
 const action=vi.fn(async()=>true),provider={preflight:vi.fn(async()=>preflight),start:vi.fn(async()=>run),run:vi.fn(async()=>run),dataset:vi.fn(async()=>[item])};
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
 expect(h.action.mock.calls.at(-1)?.[1]).toMatchObject({profile:{version:'google-place-profile-v1',identity:{cid:'123',observed_at:item.scrapedAt}}});
 expect(h.provider.dataset).toHaveBeenCalledTimes(1);
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
it('checks billing and pins the current published build before its single raw HTTP start',async()=>{
 const network=vi.fn().mockResolvedValueOnce(Response.json({data:actor}))
  .mockResolvedValueOnce(Response.json({data:build})).mockResolvedValueOnce(new Response('unavailable',{status:503}));
 const p=placePriceProvider('server-only-test-token',network);
 expect(await p.preflight()).toMatchObject({build_number:build.buildNumber,build_id:build.id});
 await expect(p.start(placePriceInput(identity))).rejects.toThrow('PLACE_PRICE_HTTP_503');
 expect(network).toHaveBeenCalledTimes(3);expect(network.mock.calls[1][0]).toContain('/builds/default');
 expect(network.mock.calls[2][0]).toContain('compass~crawler-google-places/runs?build='+build.buildNumber);
 expect(network.mock.calls[2][0]).toContain('maxTotalChargeUsd=0.5');expect(network.mock.calls[2][1]).toMatchObject({method:'POST',redirect:'error'});
});
it('refuses a missing/raised charge floor before reservation and never retries the consumed unknown job',async()=>{
 const network=vi.fn(async()=>Response.json({data:{...actor,pricingInfos:[{...actor.pricingInfos[0],minimalMaxTotalChargeUsd:1}]}}));
 const p=placePriceProvider('server-only-test-token',network);await expect(p.preflight()).rejects.toThrow('PLACE_PRICE_PREFLIGHT_CHARGE_LIMIT_INVALID');
 await expect(p.start(placePriceInput(identity))).rejects.toThrow('PLACE_PRICE_PREFLIGHT_REQUIRED');expect(network).toHaveBeenCalledTimes(1);
 const h=harness();h.provider.preflight.mockRejectedValueOnce(Error('PLACE_PRICE_PREFLIGHT_CHARGE_LIMIT_INVALID'));await h.execute();expect(h.provider.start).not.toHaveBeenCalled();expect(h.action.mock.calls.some(c=>c[0]==='reserve')).toBe(false);
 const unknown=harness({start_attempted_at:'2026-10-28'});await unknown.execute();expect(unknown.provider.preflight).not.toHaveBeenCalled();expect(unknown.provider.start).not.toHaveBeenCalled();
});
it.each([
 {error:{type:'build-outdated',message:'provider details'}},'gateway failure',
])('distinguishes a documented launch refusal from an unverified 403 response',async(body)=>{
 const network=vi.fn().mockResolvedValueOnce(Response.json({data:actor})).mockResolvedValueOnce(Response.json({data:build}))
  .mockResolvedValueOnce(typeof body==='string'?new Response(body,{status:403}):Response.json(body,{status:403}));
 const action=vi.fn(async()=>true);
 const result=await processPlacePrice(job,{action,provider:placePriceProvider('test',network)});
 const code=typeof body==='string'?'PLACE_PRICE_OUTCOME_UNKNOWN':'PLACE_PRICE_START_REJECTED';
 expect(result).toBe(code);
 expect(action).toHaveBeenLastCalledWith('fail',{code,provider_failure:{http_status:403,provider_type:typeof body==='string'?null:body.error.type}});
 expect(network.mock.calls.filter(([,options])=>options.method==='POST')).toHaveLength(1);
});
it('keeps the attempt unconsumed when the current build cannot be verified',async()=>{
 const network=vi.fn().mockResolvedValueOnce(Response.json({data:actor}))
  .mockResolvedValueOnce(Response.json({data:{...build,actId:'wrongActor'}}));
 const action=vi.fn(async()=>true);
 expect(await processPlacePrice(job,{action,provider:placePriceProvider('test',network)})).toBe('PLACE_PRICE_BUILD_UNAVAILABLE');
 expect(action.mock.calls).toEqual([['fail',{code:'PLACE_PRICE_BUILD_UNAVAILABLE'}]]);
 expect(network).toHaveBeenCalledTimes(2);
});
it('does not start when Apify reports that the published build is missing',async()=>{
 const network=vi.fn().mockResolvedValueOnce(Response.json({data:actor}))
  .mockResolvedValueOnce(Response.json({error:{type:'record-not-found'}},{status:404}));
 const action=vi.fn(async()=>true);
 expect(await processPlacePrice(job,{action,provider:placePriceProvider('test',network)})).toBe('PLACE_PRICE_HTTP_404');
 expect(action.mock.calls).toEqual([['fail',{code:'PLACE_PRICE_HTTP_404',provider_failure:{http_status:404,provider_type:'record-not-found'}}]]);
 expect(network.mock.calls.every(([,options])=>options.method!=='POST')).toBe(true);
});
it('preserves the returned run ID for reconciliation when durable binding fails',async()=>{
 const h=harness();h.action.mockResolvedValueOnce(true).mockRejectedValueOnce(Error('PLACE_PRICE_DATABASE_FAILED'));
 expect(await h.execute()).toBe('PLACE_PRICE_OUTCOME_UNKNOWN');
 expect(h.action).toHaveBeenLastCalledWith('fail',{code:'PLACE_PRICE_OUTCOME_UNKNOWN',unbound_run_id:run.id});
 expect(h.provider.start).toHaveBeenCalledTimes(1);
 expect(h.provider.run).not.toHaveBeenCalled();
});
it('uses saved place price in budget filtering, remains indicative, localizes missing values and never calls a provider',()=>{
 const network=vi.fn(()=>{throw Error('NETWORK_FORBIDDEN')});vi.stubGlobal('fetch',network);
 try{
 const saved={establishment_price:{source:'google_maps_place_details',status:'provided',observed_at:item.scrapedAt,price:item.price+' /người',unit:'per_person'},customer_spend_per_person:{ranges:[]}};
 const p=prices({budget:saved},'vi');expect(p.establishment).toMatchObject({status:'known',unit:'per_person',guaranteed_tariff:false,range:{currency:'VND',minimum:100000,maximum:200000}});
 expect(prices({},'fr').establishment.label).toBe('Prix non renseigné');expect(prices({},'vi').establishment.label).toBe('Chưa có thông tin giá');
 const row=recommendationSheet('a');row.metadata.budget=saved;
 const request={origin:{latitude:12,longitude:109},area:{kind:'radius' as const,metres:3000}};
 expect(recommendRestaurants([row],'org-a','vi',{...request,budget:{kind:'amount',currency:'VND',maximum:250000}}).proposals).toHaveLength(1);
 expect(recommendRestaurants([row],'org-a','vi',{...request,budget:{kind:'amount',currency:'VND',maximum:150000}}).proposals).toHaveLength(0);
 expect(network).not.toHaveBeenCalled();
 }finally{vi.unstubAllGlobals();}
});
