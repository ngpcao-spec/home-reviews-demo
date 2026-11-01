import {requireUser} from '../_shared/auth.ts';
import {recommendationTestHandler} from '../_shared/recommendation-test-api.ts';
import {diagnosticTrace} from '../_shared/recommendation-diagnostics.ts';

const diagnosticRuntime={deployment_id:Deno.env.get('DENO_DEPLOYMENT_ID')??null};

Deno.serve(recommendationTestHandler(requireUser,{
 key:()=>Deno.env.get('OPENAI_API_KEY')??'',http:fetch,
 diagnostics:{
  runtime:diagnosticRuntime,
  prune:async(context,organization)=>{if(!context.admin)throw Error('DIAGNOSTIC_STORE_UNAVAILABLE');const {error}=await context.admin.rpc('prune_recommendation_diagnostics_v1',{p_organization_id:organization});if(error)throw Error('DIAGNOSTIC_PRUNE_FAILED');},
  record:async(context,organization,trace)=>{
   if(!context.admin)throw Error('DIAGNOSTIC_STORE_UNAVAILABLE');
   const {data,error}=await context.admin.rpc('record_recommendation_diagnostic_v1',{p_organization_id:organization,p_user_id:context.user.id,p_attempt_id:trace.attempt_id,p_trace:trace});
   if(error)throw Error('DIAGNOSTIC_SAVE_FAILED');
   if(!data){console.warn('RECOMMENDATION_DIAGNOSTIC_SKIPPED_BUSY',{attempt_id:trace.attempt_id});return;}
   console.info('RECOMMENDATION_DIAGNOSTIC_RECORDED',{diagnostic_id:data,attempt_id:trace.attempt_id,origin:trace.origin,diagnostic_version:trace.version,deployment_id:trace.deployment_id});
  },
 },
 port:(context,organization)=>({
  reserve:async(key,requestHash)=>{
   if(!context.admin)throw Error('AI_STORE_UNAVAILABLE');
   const {data,error}=await context.admin.rpc('reserve_recommendation_with_diagnostic_v1',{p_organization_id:organization,p_user_id:context.user.id,p_cache_key:key,p_request_sha256:requestHash,
    p_trace:diagnosticTrace({stage:'diagnostic_reservation'},{status:'pending'},diagnosticRuntime)});
   if(error||!data)throw Error(error&&/^DIAGNOSTIC_[A-Z_]+$/.test(error.message)?error.message:'AI_RESERVATION_FAILED');return data;
  },
  reserveCorrectedDiagnostic:async(key,requestHash,legacyKey,legacyHash)=>{
   if(!context.admin)throw Error('AI_STORE_UNAVAILABLE');
   const {data,error}=await context.admin.rpc('reserve_corrected_recommendation_diagnostic_v1',{p_organization_id:organization,p_user_id:context.user.id,p_cache_key:key,p_request_sha256:requestHash,p_legacy_cache_key:legacyKey,p_legacy_request_sha256:legacyHash,
    p_trace:diagnosticTrace({stage:'diagnostic_reservation'},{status:'pending'},diagnosticRuntime)});
   if(error||!data)throw Error(error&&/^DIAGNOSTIC_[A-Z_]+$/.test(error.message)?error.message:'AI_RESERVATION_FAILED');return data;
  },
  finish:async(id,state,selection,metrics,errorCode)=>{
   if(!context.admin)throw Error('AI_STORE_UNAVAILABLE');
   const {data,error}=await context.admin.rpc('finish_recommendation_ai_v1',{p_id:id,p_state:state,p_selection:selection,p_metrics:metrics,p_error:errorCode});
   if(error||data!==true)throw Error('AI_RECEIPT_SAVE_FAILED');
  },
  finishWithDiagnostic:async(id,state,selection,metrics,errorCode,trace)=>{
   if(!context.admin)throw Error('AI_STORE_UNAVAILABLE');
   const {data,error}=await context.admin.rpc('finish_corrected_recommendation_diagnostic_v1',{p_id:id,p_state:state,p_selection:selection,p_metrics:metrics,p_error:errorCode,p_trace:trace});
   if(error||data!==true)throw Error('AI_RECEIPT_SAVE_FAILED');
  },
 }),
}));
