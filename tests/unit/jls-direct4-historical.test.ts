import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {DIRECT_CONFIG,DIRECT_CATEGORY_KEYS,DIRECT_NATIVE_CHOICES,directCategoryPayload,directHash,parseDirectCategoriesRounded} from '../../supabase/functions/_shared/jev-direct-categories';
import {historicalDirect4Contract,prepareHistoricalDirect4} from '../../supabase/functions/_shared/jls-direct4-historical';
import {restaurantAttempt,type RestaurantState,type RestaurantTask} from '../../supabase/functions/_shared/jls-restaurant-worker';
import {directReportInstructions} from '../../supabase/functions/_shared/jev-direct-report-preparation';
const native=(choice='mixed')=>({model:'jev-1.13.0',usage:{input_tokens:4,output_tokens:0,total_tokens:4},answers:Object.fromEntries(DIRECT_CATEGORY_KEYS.map(k=>[k,{type:'choice',choice,
 probabilities:Object.fromEntries(DIRECT_NATIVE_CHOICES.map(c=>[c,c===choice?1:0]))}]))});
it('shares the exact four-category configuration and preserves all six native choices without themes',async()=>{
 const payload=directCategoryPayload('synthetic','Good drinks but slow service.'),contract=historicalDirect4Contract();
 const result=await contract.parseJev!({} as never,{} as never,native());
 expect(result.direct4_result).toEqual(parseDirectCategoriesRounded(native()));
 expect(Object.keys(payload.questions)).toEqual(['service','price','quality','ambiance']);
 expect(Object.keys(payload.questions.service.criteria)).toEqual(['positive','negative','mixed','neutral','not_mentioned','uncertain']);
 expect(await directHash(DIRECT_CONFIG)).toBe('e5995c6e4b3a8f5949cbcde2531180ad3af503e50ee38b1b7674fceed561fe69');
 expect(result).not.toHaveProperty('theme_results');
});
it('preserves uncertainty separately, not not_mentioned, and accepts the existing rounding tolerance',async()=>{
 const raw=native('uncertain');raw.answers.service.probabilities.uncertain=.99;
 const result=await historicalDirect4Contract().parseJev!({} as never,{} as never,raw) as {direct4_result:ReturnType<typeof parseDirectCategoriesRounded>};
 expect(result.direct4_result.categories.service.native_choice).toBe('uncertain');
 expect(result.direct4_result.categories.service.classification).toBeNull();
 expect(result.direct4_result.categories.service.probabilities?.uncertain).toBe(.99);
});
it('uses the existing one-fetch worker with only the four questions and frozen text',async()=>{
 const request=directCategoryPayload('synthetic','🥰🥰'),identity={expected_served_model:'record_native_no_probe'};
 const task={id:'task',run_id:'run',organization_id:'org',phase:'jev',review_id:'review',request,
 request_sha256:await directHash(request),identity,status:'running',request_count:1,worker:'worker'} as RestaurantTask;
 const state={run:{id:'run'},protocol:{body:{organization_id:'org',pending:[{review_id:'review',request_sha256:task.request_sha256,identity}]}},artifacts:[]} as unknown as RestaurantState;
 const http=vi.fn(async(url:unknown,options?:RequestInit)=>{expect(String(url)).toContain('typesafe.ai');expect(options?.redirect).toBe('error');
 expect(JSON.parse(String(options?.body))).toEqual(request);return new Response(JSON.stringify(native()));});
 const out=await restaurantAttempt(task,state,'EXPLICIT_MOCK',http,historicalDirect4Contract());
 expect(http).toHaveBeenCalledTimes(1);expect(out.status).toBe('completed');expect(out.body.direct4_result).toBeTruthy();
 expect(out.body.raw_response_text).toBe(JSON.stringify(native()));expect(out.body).not.toHaveProperty('theme_results');
});
it.each(['network','429','500','invalid'])('never retries a %s response in the shared attempt',async kind=>{
 const request=directCategoryPayload('synthetic','Food was fine.'),identity={expected_served_model:'record_native_no_probe'};
 const task={id:'task',run_id:'run',organization_id:'org',phase:'jev',review_id:'review',request,request_sha256:await directHash(request),identity,status:'running',request_count:1} as RestaurantTask;
 const state={run:{id:'run'},protocol:{body:{organization_id:'org',pending:[{review_id:'review',request_sha256:task.request_sha256,identity}]}},artifacts:[]} as unknown as RestaurantState;
 const http=vi.fn(async()=>{if(kind==='network')throw Error('MOCK_TIMEOUT');return new Response(kind==='invalid'?'{bad':JSON.stringify(native()),{status:kind==='429'?429:kind==='500'?500:200});});
 const out=await restaurantAttempt(task,state,'EXPLICIT_MOCK',http,historicalDirect4Contract());
 expect(http).toHaveBeenCalledTimes(1);expect(out.status).not.toBe('completed');
});
it('changes only report denominators for a new scope and keeps historical 100/80 wording identical',()=>{
 expect(directReportInstructions()).toContain('over 80 analysed reviews of the fixed 100-review lot. The other 20 reviews');
 expect(directReportInstructions({source_reviews:100,analysed_text_reviews:68,textless_statistics_only:32})).toContain('over 68 analysed reviews of the fixed 100-review lot. The other 32 reviews');
});
it('rejects fabricated source identities before preparing requests',async()=>{
 await expect(prepareHistoricalDirect4({historical:{id:'wrong'} as never,published_report:null,record_sha256:'wrong',existing_direct_cache_rows:0,existing_direct4_protocols:0},'0'.repeat(40))).rejects.toThrow('DIRECT4_HISTORICAL_SOURCE_CHANGED');
});
it('keeps preparation free and routes the deployed worker to the existing execution/receipt engines',()=>{
 const sql=readFileSync('supabase/migrations/20261019132557_jls_direct4_historical_bistro.sql','utf8');
 expect(sql).not.toMatch(/create table|select public.authorize_jls_restaurant\(/);
 expect(sql).toContain('request_count=1');expect(sql).toContain('then 68 when');expect(sql).toContain('DIRECT4_HISTORICAL_DEPLOYED_QUALIFICATION_REQUIRED');
 expect(sql).toContain('authorize_jls_restaurant_pre_ready');
 const worker=readFileSync('supabase/functions/process-jls-restaurant/index.ts','utf8');
 expect(worker.indexOf("payload?.mode==='direct4_historical_probe'")).toBeLessThan(worker.indexOf('OPENAI_API_KEY'));
 const adapter=readFileSync('supabase/functions/_shared/jls-direct4-historical-server.ts','utf8');
 expect(adapter).toContain('processRestaurant(');expect(adapter).toContain('processReadySol(');
});
