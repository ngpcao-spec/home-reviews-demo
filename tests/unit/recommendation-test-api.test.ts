// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {requireUser} from '../../supabase/functions/_shared/auth';
import {recommendationTestHandler} from '../../supabase/functions/_shared/recommendation-test-api';
import {recommendationSheet} from '../fixtures/restaurant-recommendation-catalogue';
const org='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const user='33333333-3333-4333-8333-333333333333';
function fixture(options:{language?:'fr'|'vi';role?:string;anonymous?:boolean;failed?:boolean;rows?:ReturnType<typeof recommendationSheet>[];memberships?:boolean;ai?:boolean}={}){
 const language=options.language??'vi';
 const rows=(options.rows??[recommendationSheet('a',{category:'service',cuisines:['indian'],positive:'Phục vụ chu đáo.'}),recommendationSheet('b')]).map(r=>{
  r.organization_id=org;r.language=language;Object.assign(r.metadata.identity as object,{organization_id:org});
  Object.assign(r.publication!,{organization_id:org,language});return r;
 });
 const requests:URL[]=[],auths:string[]=[];
 vi.stubGlobal('Deno',{env:{get:(key:string)=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'test-anon',SUPABASE_SERVICE_ROLE_KEY:'test-service-not-used'}[key])}});
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input)),authorization=new Headers(init?.headers).get('authorization');requests.push(url);auths.push(authorization??'');
  expect(init?.method??'GET').toBe('GET');expect(authorization).toBe('Bearer caller-token');
  if(url.pathname==='/auth/v1/user')return new Response(JSON.stringify({id:user,aud:'authenticated',role:'authenticated',is_anonymous:options.anonymous??false}),{headers:{'content-type':'application/json'}});
  const table=url.pathname.split('/').at(-1),single=url.searchParams.get('select')==='role';
  if(table!=='profiles'&&table!=='organization_members')expect(url.searchParams.get('organization_id')).toBe('eq.'+org);
  const data=table==='organization_members'?single?{role:options.role??'manager'}:options.memberships===false?[]:[{user_id:user,organization_id:org,role:options.role??'manager',organization:{id:org,name:'Private fixture'}}]
   :table==='profiles'?{preferred_language:language}:table==='establishments'?rows.filter(r=>r.establishment_id!=='inactive').map(r=>({id:r.establishment_id,name:'Fixture',organization_id:org}))
   :table==='restaurant_recommendation_sheets'?rows:[];
  return new Response(JSON.stringify(data),{status:options.failed&&table==='restaurant_recommendation_sheets'?500:200,headers:{'content-type':'application/json'}});
 }));
 const reserve=vi.fn(async()=>({id:'attempt-offline',owned:true,state:'dispatched',selection:null,metrics:null}));
 const finish=vi.fn(async()=>{});
 const provider=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({model:'gpt-6.1-sol',status:'completed',usage:{input_tokens:10,output_tokens:5},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({choices:[{id:rows[0].establishment_id,reason_refs:['score_global'],caution_ref:null}]})}]}]})));
 const handler=recommendationTestHandler(requireUser,options.ai?{key:()=> 'offline-placeholder',http:provider,port:()=>({reserve,finish})}:undefined);
 const send=(body:unknown,authenticated=true,method='POST')=>handler(new Request('https://fixture.invalid/functions/v1/test-restaurant-recommendations',{method,headers:authenticated?{Authorization:'Bearer caller-token'}:{},...(method==='POST'?{body:JSON.stringify(body)}:{})}));
 return{rows,requests,auths,send,reserve,finish,provider};
}
afterEach(()=>vi.unstubAllGlobals());
describe('authenticated recommendation endpoint',()=>{
 it('rejects unauthenticated and anonymous callers before reading restaurant data',async()=>{
  const f=fixture();expect((await f.send({action:'recommend'},false)).status).toBe(401);expect(f.requests).toHaveLength(0);
  const a=fixture({anonymous:true});expect((await a.send({action:'recommend'})).status).toBe(401);expect(a.requests).toHaveLength(1);
 });
 it.each(['viewer','member'])('preserves private role restrictions for %s',async role=>{
  const f=fixture({role}),response=await f.send({action:'options'});expect(response.status).toBe(403);
  expect(f.requests.some(u=>u.pathname.endsWith('/restaurant_recommendation_sheets'))).toBe(false);
 });
 it('rejects another organization without a private read, regardless of caller-supplied IDs',async()=>{
  const f=fixture();expect((await f.send({action:'recommend',organization_id:other})).status).toBe(403);
  expect(f.requests.some(u=>u.pathname.endsWith('/restaurant_recommendation_sheets'))).toBe(false);
 });
 it.each(['fr','vi'] as const)('reads the account language %s and reuses the real engine without provider calls',async language=>{
  const f=fixture({language}),before=JSON.stringify(f.rows);
  const options=await(await f.send({action:'options'})).json();expect(options).toMatchObject({language,cuisines:['indian'],organization_id:org});
  const response=await f.send({action:'recommend',service_priority:true});expect(response.status).toBe(200);
  const data=await response.json();expect(data.result.proposals).toHaveLength(2);expect(data.result.proposals[0].establishment_id).toBe('a');
  expect(data.result.proposals.every((p:{distance_metres:unknown})=>p.distance_metres===null)).toBe(true);
  expect(f.requests.filter(u=>u.pathname.endsWith('/restaurant_recommendation_sheets')).every(u=>u.searchParams.get('language')==='eq.'+language)).toBe(true);
  expect(f.auths.every(a=>a==='Bearer caller-token')).toBe(true);expect(JSON.stringify(f.rows)).toBe(before);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
 });
 it('requires confirmed per-person prices and never pads incomplete results',async()=>{
  const a=recommendationSheet('priced'),b=recommendationSheet('unit-unknown');
  for(const row of [a,b])row.metadata.budget={establishment_price:{source:'google_maps_import',status:'provided',observed_at:'2026-10-28',price:'100-200 N ₫'+(row===a?' /người':'')}};
  const f=fixture({rows:[a,b]});
  const matched=await(await f.send({action:'recommend',maximum_vnd:200000})).json();expect(matched.result.proposals.map((p:{establishment_id:string})=>p.establishment_id)).toEqual(['priced']);
  const empty=await(await f.send({action:'recommend',maximum_vnd:150000})).json();expect(empty.result.proposals).toEqual([]);
  const all=await(await f.send({action:'recommend'})).json();expect(all.result.proposals).toHaveLength(2);
 });
 it('excludes inactive restaurants and cross-organization rows even if a transport returns them',async()=>{
  const f=fixture({rows:[recommendationSheet('active'),recommendationSheet('inactive')]});
  f.rows.push({...structuredClone(f.rows[0]),establishment_id:'foreign',organization_id:other});
  const r=await(await f.send({action:'recommend'})).json();expect(r.result.proposals.map((p:{establishment_id:string})=>p.establishment_id)).toEqual(['active']);
 });
 it.each([{action:'start'}, {action:'recommend',language:'fr'}, {action:'recommend',maximum_vnd:-1},
  {action:'recommend',maximum_vnd:'200000'}, {action:'recommend',maximum_vnd:1.5}, {action:'recommend',service_priority:'yes'},
  {action:'recommend',organization_id:'invalid'}, {action:'recommend',cuisine:'not_documented'}])('fails closed on unsupported input %j',async input=>{
  const f=fixture();expect((await f.send(input)).status).toBe(400);
 });
 it('handles errors and unsupported methods without exposing transport details or writing',async()=>{
  const f=fixture({failed:true}),r=await f.send({action:'recommend'});expect(r.status).toBe(500);
  expect(await r.json()).toEqual({error:'RECOMMENDATION_TEST_UNAVAILABLE'});
  expect((await f.send({},true,'GET')).status).toBe(405);expect((await f.send({},false,'OPTIONS')).status).toBe(200);
 });
 it('calls the AI only for an explicit compare, under the same organization/session and frozen rows',async()=>{
  const f=fixture({ai:true});await f.send({action:'options'});await f.send({action:'recommend',preference:'en famille'});
  expect(f.provider).not.toHaveBeenCalled();expect(f.reserve).not.toHaveBeenCalled();
  const r=await(await f.send({action:'compare',preference:'en famille'})).json();expect(r.comparison.status).toBe('completed');expect(r.result.proposals).toHaveLength(2);
  expect(f.provider).toHaveBeenCalledTimes(1);expect(f.finish).toHaveBeenCalledTimes(1);
 });
 it('refuses foreign organization, unsupported requirements and personal contact data before reserving an AI attempt',async()=>{
  const f=fixture({ai:true});
  for(const body of [{action:'compare',organization_id:other},{action:'compare',required_features:['invented']},{action:'compare',preference:'contact me at jane@example.com'}])expect((await f.send(body)).status).toBeGreaterThanOrEqual(400);
  expect(f.provider).not.toHaveBeenCalled();expect(f.reserve).not.toHaveBeenCalled();
 });
 it('does not confirm an unknown mandatory feature and returns the ordinary empty engine result',async()=>{
  const f=fixture({ai:true}),r=await(await f.send({action:'compare',required_features:['quiet']})).json();
  expect(r.result.proposals).toEqual([]);expect(r.comparison.status).toBe('fallback');expect(f.provider).not.toHaveBeenCalled();
 });
});
