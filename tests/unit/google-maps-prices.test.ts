// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {googleMoneyRange,googlePriceLevel} from '../../supabase/functions/_shared/google-maps-prices';
import {prices,recommendRestaurants} from '../../supabase/functions/_shared/restaurant-recommendation-engine-v1';
import {recommendationSheet} from '../fixtures/restaurant-recommendation-catalogue';
describe('observed Google structured spending labels',()=>{
 it.each([
  ['100-200\u00a0N\u00a0₫',100000,200000],['900\u00a0N\u00a0₫ - 1\u00a0Tr\u00a0₫',900000,1000000],['1-100.000\u00a0₫',1,100000],
  ['200-300 N ₫',200000,300000],['1.000.000–2.000.000 ₫',1000000,2000000],['10–20 EUR',10,20],['10,50–20,50 €',10.5,20.5],
 ])('parses %s without losing the original label or inventing a currency',(raw,minimum,maximum)=>{
  expect(googleMoneyRange(raw)).toEqual({status:'parsed',currency:raw.includes('€')||raw.includes('EUR')?'EUR':'VND',minimum,maximum,bounds:'closed'});
 });
 it('preserves an open limit rather than inventing an upper range',()=>{
  expect(googleMoneyRange('Trên 1.000.000 ₫')).toEqual({status:'parsed',currency:'VND',minimum:1000000,maximum:null,bounds:'above'});
  expect(googleMoneyRange('Moins de 20 €')).toEqual({status:'parsed',currency:'EUR',minimum:null,maximum:20,bounds:'below'});
 });
 it.each([null,'',true,'100-200','10–20 $','70 000 wons','1.000–2.000 EUR','200–100 VND','10 USD–20 VND'])('leaves ambiguous or absent data unknown: %s',raw=>{
  expect(googleMoneyRange(raw).status).toBe('unparsed');
 });
 it('keeps Google price levels distinct from amount ranges and numeric strings without a level field',()=>{
  expect(googlePriceLevel('₫₫')).toBe(2);expect(googlePriceLevel('PRICE_LEVEL_MODERATE')).toBe(2);expect(googlePriceLevel(0)).toBe(0);
  expect(googlePriceLevel('2',false)).toBeNull();expect(googlePriceLevel('€$',false)).toBeNull();expect(googlePriceLevel('100-200 N ₫')).toBeNull();
 });
 it('exposes parsed client spending separately and never uses it to pass the establishment budget filter',()=>{
  const row=recommendationSheet('fixture');row.metadata.budget={establishment_price:{price:null,status:'not_provided',source:'google_maps_import',observed_at:'2026-10-28'},
    customer_spend_per_person:{source:'frozen_report_review_context',observed_at:'2026-10-27',ranges:[{value:'100-200 N ₫',review_count:5,source_fields:['source_bindings[].review_context.price_per_person'],period_start:'2026-10-01',period_end:'2026-10-20'}]}};
  const p=prices(row.metadata);expect(p.establishment.status).toBe('unknown');expect(p.customer_spend_per_person).toMatchObject({guaranteed_tariff:false,observed_at:'2026-10-27',ranges:[{parsed:{currency:'VND',minimum:100000,maximum:200000}}]});
  const q={origin:{latitude:12,longitude:109},area:{kind:'radius' as const,metres:1000},budget:{kind:'amount' as const,currency:'VND',maximum:300000}};
  expect(recommendRestaurants([row],'org-a','vi',q).proposals).toEqual([]);
  (row.metadata.budget as Record<string,unknown>).establishment_price={price:'100-200 N ₫',status:'provided',source:'google_maps_import',observed_at:'2026-10-28'};
  expect(recommendRestaurants([row],'org-a','vi',q).proposals).toHaveLength(1);
  (row.metadata.budget as Record<string,unknown>).establishment_price={price:'Trên 1.000.000 ₫',status:'provided',source:'google_maps_import',observed_at:'2026-10-28'};
  expect(recommendRestaurants([row],'org-a','vi',q).proposals).toHaveLength(0);
 });
});
