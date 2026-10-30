import {requireUser} from '../_shared/auth.ts';
import {recommendationTestHandler} from '../_shared/recommendation-test-api.ts';

Deno.serve(recommendationTestHandler(requireUser,{
 key:()=>Deno.env.get('OPENAI_API_KEY')??'',http:fetch,
 port:(context,organization)=>({
  reserve:async(key,requestHash)=>{
   if(!context.admin)throw Error('AI_STORE_UNAVAILABLE');
   const {data,error}=await context.admin.rpc('reserve_recommendation_ai_v1',{p_organization_id:organization,p_user_id:context.user.id,p_cache_key:key,p_request_sha256:requestHash});
   if(error||!data)throw Error('AI_RESERVATION_FAILED');return data;
  },
  finish:async(id,state,selection,metrics,errorCode)=>{
   if(!context.admin)throw Error('AI_STORE_UNAVAILABLE');
   const {data,error}=await context.admin.rpc('finish_recommendation_ai_v1',{p_id:id,p_state:state,p_selection:selection,p_metrics:metrics,p_error:errorCode});
   if(error||data!==true)throw Error('AI_RECEIPT_SAVE_FAILED');
  },
 }),
}));
