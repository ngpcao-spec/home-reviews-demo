// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {prices,recommendRestaurants,type Request} from '../../supabase/functions/_shared/restaurant-recommendation-engine-v1';
import {recommendationSheet} from '../fixtures/restaurant-recommendation-catalogue';

const request:Request={origin:{latitude:12,longitude:109},area:{kind:'radius',metres:1000},
 budget:{kind:'amount',currency:'VND',minimum:100000,maximum:200000,unit:'per_person'}};
const saved={source:'google_maps_place_details',status:'provided',observed_at:'2026-10-28T14:51:44Z',
 google_id:'123456789',price:'100-200 N ₫'};
const proof={source:'google_maps_ui',url:'https://www.google.com/maps?cid=123456789',
 observed_at:'2026-10-28T14:44:45Z',label:'100.000–200.000 ₫/người'};
const metadata=(price:Record<string,unknown>)=>({budget:{establishment_price:price}});
function run(price:Record<string,unknown>,q=request){
 const row=recommendationSheet('fixture');Object.assign(row.metadata,metadata(price));
 return recommendRestaurants([row],'org-a','vi',q);
}
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');})));
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();});

describe('explicit per-person Google price evidence',()=>{
 it.each(['100-200 N ₫/người','100-200 N ₫ mỗi người','100000–200000 VND par personne',
  '100000–200000 VND per person','100000–200000 VND / person'])('accepts the explicit saved label %s',price=>{
  expect(run({...saved,price}).proposals[0].budget.establishment).toMatchObject({
   unit:'per_person',unit_status:'confirmed',unit_label:'Mỗi người',indicative:true,guaranteed_tariff:false,
  });
 });
 it('accepts a saved, dated Google Maps observation quoting the same price and identity',()=>{
  expect(run({...saved,unit:'per_person',unit_evidence:proof}).proposals).toHaveLength(1);
  expect(run({...saved,place_id:'verified-place',unit_evidence:{...proof,url:'https://www.google.com/maps?query_place_id=verified-place'}}).proposals).toHaveLength(1);
 });
 it.each([
  {},{unit:'per_person'},{unit_evidence:{unit:'per_person'}},
  {unit_evidence:{...proof,source:'customer_review'}},
  {unit_evidence:{...proof,label:'100.000–200.000 ₫'}},
  {unit_evidence:{...proof,label:'100000–200000 VND per person or per table'}},
  {unit_evidence:{...proof,label:'100.000–300.000 ₫/người'}},
  {unit_evidence:{...proof,label:'100000–200000 USD per person'}},
  {unit_evidence:{...proof,url:'https://www.google.com/maps?cid=987654321'}},
  {unit_evidence:{...proof,url:'https://www.google.com/maps?cid=123456789&query_place_id=another-place'}},
  {unit_evidence:{...proof,url:'https://www.google.com.evil.test/maps?cid=123456789'}},
  {unit_evidence:{...proof,url:'http://www.google.com/maps?cid=123456789'}},
  {unit_evidence:{...proof,url:undefined}},
  {unit_evidence:{...proof,observed_at:undefined}},
  {unit_evidence:{...proof,observed_at:'invalid'}},
  {unit:'per_table',unit_evidence:proof},
 ])('keeps absent, ambiguous, conflicting or unbound unit evidence unknown: %j',patch=>{
  const price={...saved,...patch},r=run(price);
  expect(r.proposals).toEqual([]);
  expect(r.excluded[0].reasons).toContain('BUDGET_UNIT_UNCONFIRMED');
  expect(prices(metadata(price),'fr').establishment).toMatchObject({status:'known',unit:null,unit_status:'unknown',unit_label:'Unité inconnue'});
 });
 it('does not use a price label unit on a different structured range',()=>{
  expect(run({...saved,price:saved.price+' par personne',price_range:{currency:'VND',minimum:100000,maximum:300000}},
   {...request,budget:{kind:'amount',currency:'VND',maximum:400000}}).proposals).toEqual([]);
 });
 it('does not turn customer spending or a bare unit flag into an establishment price unit',()=>{
  const row=recommendationSheet('fixture');row.metadata.budget={establishment_price:{...saved,unit:'per_person'},
   customer_spend_per_person:{source:'frozen_report_review_context',ranges:[{value:'100-200 N ₫/người',review_count:5}]}};
  expect(recommendRestaurants([row],'org-a','vi',request).proposals).toEqual([]);
 });
 it('keeps legacy monetary requests conservative when the request unit is omitted',()=>{
  const q:Request={...request,budget:{kind:'amount',currency:'VND',maximum:200000}};
  expect(run(saved,q).proposals).toEqual([]);
  expect(run({...saved,unit_evidence:proof},q).proposals).toHaveLength(1);
 });
});

describe('currency, closed bounds and account language remain required',()=>{
 it('checks both bounds and currency even with confirmed per-person evidence',()=>{
  const price={...saved,unit_evidence:proof};
  expect(run(price).proposals).toHaveLength(1);
  for(const budget of [
   {kind:'amount',currency:'USD',maximum:200000},
   {kind:'amount',currency:'VND',maximum:199999},
   {kind:'amount',currency:'VND',minimum:100001,maximum:200000},
  ] as const)expect(run(price,{...request,budget}).proposals).toEqual([]);
  for(const price of ['Trên 100.000 ₫/người','10–20 $ per person','200-100 N ₫/người'])
   expect(run({...saved,price}).proposals).toEqual([]);
 });
 it('rejects unsupported request units rather than treating them as per person',()=>{
  expect(()=>run({...saved,unit_evidence:proof},{...request,budget:{kind:'amount',currency:'VND',maximum:200000,unit:'per_table'}} as unknown as Request)).toThrow('INVALID_BUDGET');
 });
 it('keeps unknown prices and units eligible without a budget and preserves source data',()=>{
  const rows=[recommendationSheet('no-price'),recommendationSheet('no-unit')];
  Object.assign(rows[1].metadata,metadata(saved));const before=structuredClone(rows);
  const result=recommendRestaurants(rows,'org-a','vi',{...request,budget:undefined});
  expect(result.proposals.map(p=>p.establishment_id).sort()).toEqual(['no-price','no-unit']);
  expect(result.proposals.every(p=>p.budget.establishment.unit_label==='Chưa rõ đơn vị')).toBe(true);
  expect(rows).toEqual(before);
 });
 it('localizes known and unknown units in French and Vietnamese',()=>{
  for(const [language,known,unknown] of [['fr','Par personne','Unité inconnue'],['vi','Mỗi người','Chưa rõ đơn vị']]){
   expect(prices(metadata({...saved,unit_evidence:proof}),language).establishment.unit_label).toBe(known);
   expect(prices(metadata(saved),language).establishment.unit_label).toBe(unknown);
  }
 });
});
