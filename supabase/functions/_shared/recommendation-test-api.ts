import type {AuthContext} from './auth.ts';
import {recommendationCuisineOptions,type Request as RecommendationRequest} from './restaurant-recommendation-engine-v1.ts';
import {readRestaurantRecommendationCatalogue,recommendFromCatalogue} from './restaurant-recommendation-read-v1.ts';
import {corsHeaders} from './cors.ts';
import {AI_FEATURES,aiHash,checkedRecommendationPreference,compareAi,featureOption,prepareAi,validAiFeatures,type AiPort} from './recommendation-ai.ts';

export const RECOMMENDATION_TEST_API_VERSION='recommendation-test-v1';
type Context={client:AuthContext['client'];admin?:AuthContext['admin'];user:Pick<AuthContext['user'],'id'|'is_anonymous'>};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Authorization, Origin'}});
function criteria(raw:unknown) {
  if(!raw || typeof raw!=='object'||Array.isArray(raw))throw Error('INVALID_RECOMMENDATION_REQUEST');
  const b=raw as Record<string,unknown>;
  if(Object.keys(b).some(k=>!['action','organization_id','cuisine','maximum_vnd','service_priority','preference','required_features','preference_mode'].includes(k))
    || !['options','recommend','compare'].includes(String(b.action))
    || b.organization_id!==undefined && (typeof b.organization_id!=='string'||!uuid.test(b.organization_id))
    || b.cuisine!==undefined && (typeof b.cuisine!=='string'||!b.cuisine||b.cuisine.length>80)
    || b.maximum_vnd!==undefined && (typeof b.maximum_vnd!=='number'||!Number.isSafeInteger(b.maximum_vnd)||b.maximum_vnd<0)
    || b.service_priority!==undefined && typeof b.service_priority!=='boolean'
    || b.required_features!==undefined && !validAiFeatures(b.required_features)
    || b.preference_mode!==undefined && !['free_text_v2','report_facts_v3'].includes(String(b.preference_mode)))throw Error('INVALID_RECOMMENDATION_REQUEST');
  if(b.preference!==undefined)b.preference=checkedRecommendationPreference(b.preference);
  return b as {action:'options'|'recommend'|'compare';organization_id?:string;cuisine?:string;maximum_vnd?:number;service_priority?:boolean;preference?:string;required_features?:string[];preference_mode?:'free_text_v2'|'report_facts_v3'};
}
export function recommendationTestHandler(authorize:(request:Request)=>Promise<Context>,dependencies?:{key:()=>string;http:typeof fetch;port:(context:Context,organization:string)=>AiPort}) {
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
   // Require the client explaining that anonymous report excerpts are now sent, before any read/reservation.
   if(input.action==='compare'&&input.preference_mode!=='report_facts_v3')throw Error('RECOMMENDATION_CLIENT_UPDATE_REQUIRED');
   const membership=await context.client.from('organization_members').select('user_id,organization_id,role,organization:organizations!inner(id,name)')
    .eq('user_id',context.user.id).in('role',['owner','admin','manager']).order('organization_id');
   if(membership.error)throw Error('RECOMMENDATION_READ_FAILED');
   const organizations=(membership.data??[]).flatMap(m=>{
    const org=m.organization as unknown as {id:string;name:string}|null;
    return org && m.user_id===context.user.id && ['owner','admin','manager'].includes(m.role) && org.id===m.organization_id && uuid.test(org.id)
     ?[{id:org.id,name:org.name}]:[];
   });
   const organizationId=input.organization_id??organizations[0]?.id;
   if(!organizationId||!organizations.some(o=>o.id===organizationId))throw Error('FORBIDDEN');
   const catalogue=await readRestaurantRecommendationCatalogue(context,organizationId);
   const cuisines=recommendationCuisineOptions(catalogue.rows,organizationId,catalogue.language);
   if(input.cuisine&&!cuisines.includes(input.cuisine))throw Error('INVALID_RECOMMENDATION_REQUEST');
   const supported=prepareAi(catalogue,{geography:'not_requested'},'').proposals;
   const features=AI_FEATURES.filter(f=>supported.some(p=>p.features[f]?.status==='reported')).map(f=>featureOption(f,catalogue.language));
   const common={api_version:RECOMMENDATION_TEST_API_VERSION,language:catalogue.language,organization_id:organizationId,organizations,cuisines,features};
   if(input.action==='options')return reply(common);
   const query:RecommendationRequest={geography:'not_requested',...(input.cuisine?{cuisines:[input.cuisine]}:{}),
    ...(input.required_features?.length?{required_features:[...input.required_features].sort()}:{}),
    ...(input.maximum_vnd!==undefined?{budget:{kind:'amount',currency:'VND',maximum:input.maximum_vnd,unit:'per_person'}}:{}),
    ...(input.service_priority?{preferences:{categories:['service']}}:{})};
   const result=recommendFromCatalogue(catalogue,query);
   if(input.action!=='compare')return reply({...common,result});
   if(!dependencies)return reply({...common,result,comparison:{status:'fallback',notice:'AI_UNAVAILABLE',model:'gpt-6.1-sol',candidate_count:0,selections:[]}});
   const access=organizations;
   const snapshot=await aiHash(catalogue);
   const comparison=await compareAi({catalogue,query,preference:(input.preference??'').trim().normalize('NFC'),userId:context.user.id,access,port:dependencies.port(context,organizationId),key:dependencies.key(),http:dependencies.http,
    unchanged:async()=>{
     const current=await readRestaurantRecommendationCatalogue(context,organizationId);
     return await aiHash(current)===snapshot;
    }});
   // Membership, language and corpus are checked again before returning any comparison (including fallback).
   const current=await readRestaurantRecommendationCatalogue(context,organizationId);
   if(await aiHash(current)!==snapshot)return reply({error:'RECOMMENDATION_DATA_CHANGED'},409);
   console.info('RECOMMENDATION_COMPARISON_RESPONSE',{attempt_id:comparison.attempt_id??null,status:comparison.status,model:comparison.model,candidate_count:comparison.candidate_count});
   return reply({...common,result,comparison});
  }catch(error){
   const message=error instanceof Error?error.message:'';
   const status=message==='UNAUTHORIZED'?401:message==='FORBIDDEN'?403:message==='INVALID_RECOMMENDATION_REQUEST'?400:message==='RECOMMENDATION_CLIENT_UPDATE_REQUIRED'?409:500;
   const code=status===500?'RECOMMENDATION_TEST_UNAVAILABLE':message;
   if(status===500)console.warn('Recommendation test read failed',{code});
   return reply({error:code},status);
  }
 };
}
