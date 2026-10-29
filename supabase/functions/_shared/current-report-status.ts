// Read-only compatibility projection for the existing normal generation button.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {historicalRunStatus} from './historical-run-status.ts';
type Run=Parameters<typeof historicalRunStatus>[0]&{id:string;created_at?:string;completed_at?:string|null};
export async function currentHistoricalStatus(admin:SupabaseClient,run:Run){
 const b=await admin.from('report_generation_requests').select('id,engine,comparison_id,jev_transport,shared_jev_version,created_at').eq('source_run_id',run.id).maybeSingle();if(b.error)throw Error('REPORT_RUN_READ_FAILED');
 if(b.data?.engine!=='jev_sol_v2')return {...historicalRunStatus(run),...(b.data?{request_id:b.data.id,engine:b.data.engine}:{})};
 const abandoned=await admin.from('report_generation_abandonments').select('abandoned_at').eq('request_id',b.data.id).maybeSingle();
 if(abandoned.error)throw Error('REPORT_RUN_READ_FAILED');
 // A V2 source is not a legacy Sol batching plan. In particular, null must not
 // fall back to consultantBatches(snapshot), even before its native plan exists.
 const base=historicalRunStatus({...run,snapshot:undefined,total_steps:null,cursor:0});
 const binding={request_id:b.data.id,source_run_id:run.id,engine:b.data.engine,comparison_id:b.data.comparison_id,
  jev_transport:b.data.jev_transport,created_at:b.data.created_at??run.created_at,completed_at:run.completed_at??null};
 if(abandoned.data?.abandoned_at)return {...base,...binding,status:'failed' as const,abandoned:true,can_abandon:false,can_resume:false,resumable:false,error_code:'REPORT_GENERATION_ABANDONED',progress:0,total_steps:null};
 let stage='preparing',progress=0,total:number|null=null;
 if(b.data.comparison_id){
  const p=await admin.from('analysis_parallel_reports').select('run_id,current_source_run_id,configuration_version,state,error_code').eq('id',b.data.comparison_id).single();if(p.error)throw Error('REPORT_RUN_READ_FAILED');
  if(p.data.current_source_run_id!==run.id)throw Error('REPORT_SOURCE_BINDING_CHANGED');
  if(b.data.jev_transport==='batch_initial_v1'){
   if(p.data.configuration_version!=='jev-multi-review-initial-v1'||p.data.run_id!==null)throw Error('REPORT_TRANSPORT_BINDING_CHANGED');
   const r=await admin.from('analysis_jev_batch_runs').select('id,status,stage,error_code,completed_at,sol_request_count,armed,expires_at').eq('report_id',b.data.comparison_id).eq('current_source_run_id',run.id).single();
   if(r.error)throw Error('REPORT_RUN_READ_FAILED');
   const t=await admin.from('analysis_jev_batch_tasks').select('status,reviews').eq('run_id',r.data.id);
   if(t.error)throw Error('REPORT_RUN_READ_FAILED');
   const complete=t.data.filter(t=>t.status==='completed');
   const shared=b.data.shared_jev_version?await admin.rpc('jev_shared_progress',{p_consumer:run.id}):null;
   if(shared?.error)throw Error('REPORT_RUN_READ_FAILED');
   const reused=shared?.data as {completed_reviews:number;total_reviews:number}|undefined;
   const published=['completed','needs_review'].includes(p.data.state),failed=['blocked','invalid_output','billing_uncertain','authorization_expired'].includes(r.data.status);
   const status=published?'completed':failed?'failed':run.status;
   return {...base,...binding,status,error_code:r.data.error_code??p.data.error_code??run.error_code,
    stage:published?'completed':r.data.stage,progress:complete.length,total_steps:t.data.length,progress_unit:'jev_batches',
    batch_run_id:r.data.id,completed_at:r.data.completed_at??binding.completed_at,
    shared_jev:!!b.data.shared_jev_version,
    completed_reviews:reused?reused.completed_reviews:complete.reduce((sum,t)=>sum+t.reviews,0),total_reviews:reused?reused.total_reviews:t.data.reduce((sum,t)=>sum+t.reviews,0),
    unknown_batches:t.data.filter(t=>t.status==='unknown').length,sol_attempts:r.data.sol_request_count,
    can_abandon:status==='failed'&&r.data.armed===false,
    can_resume:status==='running'&&r.data.armed===true&&Date.parse(r.data.expires_at)>Date.now()};
  }
  if(!p.data.run_id)throw Error('REPORT_TRANSPORT_BINDING_CHANGED');
  const [r,t]=await Promise.all([admin.from('analysis_jls_restaurant_runs').select('stage').eq('id',p.data.run_id).single(),admin.from('analysis_jls_restaurant_tasks').select('status').eq('run_id',p.data.run_id).eq('phase','jev')]);
  if(r.error||t.error)throw Error('REPORT_RUN_READ_FAILED');stage=r.data.stage;total=t.data.length+2;progress=t.data.filter(t=>['completed','reused'].includes(t.status)).length+(stage==='validate_sol'?1:0);
 }
 return {...base,...binding,can_abandon:run.status==='failed'&&b.data.jev_transport==='batch_initial_v1',progress:run.status==='completed'?total??progress:progress,total_steps:total,stage,progress_unit:'steps'};
}
