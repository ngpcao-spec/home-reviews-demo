import type {AuthContext} from './auth.ts';
import {recommendationCuisineOptions,type Request as RecommendationRequest} from './restaurant-recommendation-engine-v1.ts';
import {readRestaurantRecommendationCatalogue,recommendFromCatalogue} from './restaurant-recommendation-read-v1.ts';
import {corsHeaders} from './cors.ts';

export const RECOMMENDATION_TEST_API_VERSION='recommendation-test-v1';
type Context={client:AuthContext['client'];user:Pick<AuthContext['user'],'id'|'is_anonymous'>};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Authorization, Origin'}});
function criteria(raw:unknown) {
  if(!raw || typeof raw!=='object'||Array.isArray(raw))throw Error('INVALID_RECOMMENDATION_REQUEST');
  const b=raw as Record<string,unknown>;
  if(Object.keys(b).some(k=>!['action','organization_id','cuisine','maximum_vnd','service_priority'].includes(k))
    || !['options','recommend'].includes(String(b.action))
    || b.organization_id!==undefined && (typeof b.organization_id!=='string'||!uuid.test(b.organization_id))
    || b.cuisine!==undefined && (typeof b.cuisine!=='string'||!b.cuisine||b.cuisine.length>80)
    || b.maximum_vnd!==undefined && (typeof b.maximum_vnd!=='number'||!Number.isSafeInteger(b.maximum_vnd)||b.maximum_vnd<0)
    || b.service_priority!==undefined && typeof b.service_priority!=='boolean')throw Error('INVALID_RECOMMENDATION_REQUEST');
  return b as {action:'options'|'recommend';organization_id?:string;cuisine?:string;maximum_vnd?:number;service_priority?:boolean};
}
export function recommendationTestHandler(authorize:(request:Request)=>Promise<Context>) {
 return async(request:Request):Promise<Response>=>{
  if(request.method==='OPTIONS')return reply({});
  if(request.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
  try{
   const context=await authorize(request);
   if(context.user.is_anonymous)throw Error('UNAUTHORIZED');
   const text=await request.text();
   if(text.length>8192)return reply({error:'INVALID_RECOMMENDATION_REQUEST'},413);
   let raw:unknown;try{raw=JSON.parse(text);}catch{throw Error('INVALID_RECOMMENDATION_REQUEST');}
   const input=criteria(raw);
   const membership=await context.client.from('organization_members').select('user_id,organization_id,role,organization:organizations!inner(id,name)')
    .eq('user_id',context.user.id).in('role',['owner','admin','manager']).order('organization_id');
   if(membership.error)throw Error('RECOMMENDATION_READ_FAILED');
   const organizations=(membership.data??[]).flatMap(m=>{
    const org=m.organization as unknown as {id:string;name:string}|null;
    return m.user_id===context.user.id && ['owner','admin','manager'].includes(m.role) && org?.id===m.organization_id && uuid.test(org.id)
     ?[{id:org.id,name:org.name}]:[];
   });
   const organizationId=input.organization_id??organizations[0]?.id;
   if(!organizationId||!organizations.some(o=>o.id===organizationId))throw Error('FORBIDDEN');
   const catalogue=await readRestaurantRecommendationCatalogue(context,organizationId);
   const cuisines=recommendationCuisineOptions(catalogue.rows,organizationId,catalogue.language);
   if(input.cuisine&&!cuisines.includes(input.cuisine))throw Error('INVALID_RECOMMENDATION_REQUEST');
   const common={api_version:RECOMMENDATION_TEST_API_VERSION,language:catalogue.language,organization_id:organizationId,organizations,cuisines};
   if(input.action==='options')return reply(common);
   const query:RecommendationRequest={geography:'not_requested',...(input.cuisine?{cuisines:[input.cuisine]}:{}),
    ...(input.maximum_vnd!==undefined?{budget:{kind:'amount',currency:'VND',maximum:input.maximum_vnd,unit:'per_person'}}:{}),
    ...(input.service_priority?{preferences:{categories:['service']}}:{})};
   return reply({...common,result:recommendFromCatalogue(catalogue,query)});
  }catch(error){
   const message=error instanceof Error?error.message:'';
   const status=message==='UNAUTHORIZED'?401:message==='FORBIDDEN'?403:message==='INVALID_RECOMMENDATION_REQUEST'?400:500;
   const code=status===500?'RECOMMENDATION_TEST_UNAVAILABLE':message;
   if(status===500)console.warn('Recommendation test read failed',{code});
   return reply({error:code},status);
  }
 };
}
