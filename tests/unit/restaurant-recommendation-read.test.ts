// @vitest-environment node
import {createClient} from '@supabase/supabase-js';
import {expect,it,vi} from 'vitest';
import {readRestaurantRecommendations,RECOMMENDATION_SELECT} from '../../supabase/functions/_shared/restaurant-recommendation-read-v1';
import {recommendationSheet as sheet} from '../fixtures/restaurant-recommendation-catalogue';
const request = {origin:{latitude:12,longitude:109},area:{kind:'radius' as const,metres:10000}};
function client(options: {role?: string; language?: string; fail?: boolean; pages?: number} = {}) {
  const reads: URL[] = [];
  const http = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url=new URL(String(input));reads.push(url);
    expect(init?.method ?? 'GET').toBe('GET');
    expect(url.searchParams.get('organization_id')).toBe(url.pathname.endsWith('/profiles') ? null : 'eq.org-a');
    const table=url.pathname.split('/').at(-1);
    const data=table==='organization_members' ? {role:options.role ?? 'manager'} : table==='profiles' ? {preferred_language:options.language ?? 'vi'}
      : table==='establishments' ? [{id:'no-report',name:'Fixture without report',organization_id:'org-a'},...Array.from({length:options.pages?201:1},(_,i)=>({id:i<200?`0-${i}`:'200-0',name:'Fixture',organization_id:'org-a'}))].slice(Number(url.searchParams.get('offset')??0),Number(url.searchParams.get('offset')??0)+200)
      : options.fail ? {message:'read failed'} : Array.from({length:options.pages && url.searchParams.get('offset')==='0' ? 200 : 1},(_,i) => sheet(`${url.searchParams.get('offset')}-${i}`));
    return new Response(JSON.stringify(data),{status:options.fail && table==='restaurant_recommendation_sheets'?500:200,headers:{'content-type':'application/json'}});
  });
  const c=createClient('https://example.invalid','test-anon-key',{global:{fetch:http,headers:{Authorization:'Bearer caller-session'}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  return {c:{client:c,user:{id:'user-a'}},http,reads};
}
it('reads only the caller organization and account language, with caller authorization and lossless joined projection',async () => {
  const f=client();const r=await readRestaurantRecommendations(f.c,'org-a',request);expect(r.proposals).toHaveLength(1);
  expect(f.reads.map(u => u.pathname.split('/').at(-1))).toEqual(['organization_members','profiles','restaurant_recommendation_sheets','establishments']);
  const u=f.reads.find(u => u.pathname.endsWith('/restaurant_recommendation_sheets'))!;expect(u.searchParams.get('language')).toBe('eq.vi');expect(u.searchParams.get('select')).toBe(RECOMMENDATION_SELECT);
  expect(RECOMMENDATION_SELECT).toContain('calculation_text:calculation::text');expect(RECOMMENDATION_SELECT).toContain('current_report_publications!inner');
  expect(f.http.mock.calls.every(c => new Headers(c[1]?.headers).get('authorization')==='Bearer caller-session')).toBe(true);
  expect(r.excluded).toContainEqual({establishment_id:'no-report',name:'Fixture without report',report_id:'',reasons:['NO_REPORT_SHEET_IN_ACCOUNT_LANGUAGE']});
});
it('denies unauthorized roles before reading private sheets; missing account language has no fallback',async () => {
  for(const role of ['viewer','member']) {const f=client({role});await expect(readRestaurantRecommendations(f.c,'org-a',request)).rejects.toThrow('FORBIDDEN');expect(f.reads).toHaveLength(1);}
  const f=client({language:'en'});await expect(readRestaurantRecommendations(f.c,'org-a',request)).rejects.toThrow('PREFERRED_LANGUAGE_REQUIRED');expect(f.reads).toHaveLength(2);
});
it('uses FR from the account without borrowing a Vietnamese sheet or mutating preferences',async () => {
  const f=client({language:'fr'});const r=await readRestaurantRecommendations(f.c,'org-a',request);expect(r.proposals).toEqual([]);expect(f.reads.find(u => u.pathname.endsWith('/restaurant_recommendation_sheets'))!.searchParams.get('language')).toBe('eq.fr');
});
it('paginates rather than silently losing rows, and fails closed if the read fails',async () => {
  const f=client({pages:2});await readRestaurantRecommendations(f.c,'org-a',request);expect(f.reads.filter(u => u.pathname.endsWith('/restaurant_recommendation_sheets')).map(u => u.searchParams.get('offset'))).toEqual(['0','200']);
  const g=client({fail:true});await expect(readRestaurantRecommendations(g.c,'org-a',request)).rejects.toThrow('RECOMMENDATION_READ_FAILED');
});
