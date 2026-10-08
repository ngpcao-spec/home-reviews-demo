import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2'
import {createJevClient} from './jev.ts'
import {parseThemes} from './jev-themes.ts'
import {historicalRetry} from './historical-report-policy.ts'
import {parseV9Sentiment,type V9Task} from './historical-v9-core.ts'
import {FIRST_V11_SOURCE,FIRST_V11_COMPARISON,V11_CONFIG,deriveV11,v11Costs,compareV11Sources,validateV11Snapshot,type V11Usage,type V11ComparisonSource,type V11Job} from './historical-v11-core.ts'
import {v11Payload} from './jev-v11-calibration.ts'
import {writeV9Narrative,v9NarrativeContext,assembleV9Narrative} from './historical-v9-narrative.ts'
import {structuredContextStats} from './structured-review-context.ts'
export type {V11Job} from './historical-v11-core.ts'

const safe=(e:unknown)=>e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'REPORT_V11_NETWORK_ERROR'
export async function processHistoricalV11Run(admin:SupabaseClient,initial:V11Job,worker:string){let run=initial;const started=Date.now();const log=(event:string,extra:Record<string,unknown>={})=>console.info(event,{generation_id:run.generation_id,analysis_version:11,...extra})
  const rpc=async(name:string,params:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,params);if(error)throw new Error(error.message.includes('REPORT_LEASE_LOST')?'REPORT_LEASE_LOST':'REPORT_PROGRESS_SAVE_FAILED');return data}
  const refresh=async()=>{const {data,error}=await admin.from('historical_report_runs').select('*').eq('id',run.id).eq('organization_id',run.organization_id).single();if(error||!data)throw new Error('REPORT_RUN_READ_FAILED');run=data as V11Job}
  const checkpoint=async(values:Record<string,unknown>)=>{if(await rpc('checkpoint_historical_report_run',{p_run_id:run.id,p_generation_id:run.generation_id,p_worker_id:worker,p_cursor:run.cursor,p_values:values})!==true)throw new Error('REPORT_LEASE_LOST');Object.assign(run,values)}
  const metric=async(action:string,values:Record<string,unknown>={})=>{if(await rpc('historical_v11_metrics_update',{p_run_id:run.id,p_worker_id:worker,p_action:action,p_values:values})!==true)throw new Error('REPORT_LEASE_LOST')}
  const readMetrics=async()=>{const {data,error}=await admin.from('historical_jev_v11_run_metrics').select('*').eq('run_id',run.id).eq('organization_id',run.organization_id).single();if(error||!data)throw new Error('REPORT_RUN_READ_FAILED');return data as V11Usage&{narrative_result:Record<string,unknown>|null}}
  const publish=async(row:Record<string,unknown>)=>{if(await rpc('complete_experimental_v11_report',{p_run_id:run.id,p_generation_id:run.generation_id,p_worker_id:worker,p_cursor:run.cursor,p_report:row})!==true)throw new Error('REPORT_LEASE_LOST');log('V11_REPORT_COMPLETED');return {generation_id:run.generation_id,status:'completed',cursor:run.cursor}}
  try{
    if(run.status==='failed')return {generation_id:run.generation_id,status:'failed'};validateV11Snapshot(run);if(run.snapshot.publication)return await publish(run.snapshot.publication)
    const key=Deno.env.get('TYPESAFE_API_KEY');if(!key?.trim())throw new Error('JEV_NOT_CONFIGURED')
    let processed=0
    while(Date.now()-started<70_000){const tasks=await rpc('claim_historical_jev_v11_tasks',{p_run_id:run.id,p_worker_id:worker,p_limit:8}) as V9Task[];if(!tasks.length)break
      const outcomes=await Promise.allSettled(tasks.map(async task=>{const review=run.snapshot.reviews.find(r=>r.id===task.review_id);if(!review?.analysis_text?.trim())throw new Error('REPORT_V11_TASK_SOURCE_INVALID');let input=0,output=0,requests=0,retries=0,model:string|null=null,usageComplete=true,result:unknown=null,errorCode:string|null=null;const begin=Date.now(),client=createJevClient(key,{onUsage:(u,m)=>{input+=u.input_tokens;output+=u.output_tokens;model=m},onAttempt:()=>{requests++},onRetry:()=>{retries++}})
        try{const payload=v11Payload(task.kind,task.review_alias,review.analysis_text!),response=task.kind==='themes'?await client.evaluatePayload(payload,parseThemes):await client.evaluatePayload(payload,parseV9Sentiment);result=response.decision;model=response.model}catch(e){errorCode=safe(e);if(['JEV_NETWORK_ERROR','JEV_INVALID_USAGE'].includes(errorCode)||errorCode==='JEV_INVALID_RESPONSE'&&!input&&!output)usageComplete=false}
        const values={status:errorCode?'failed':'completed',result,error_code:errorCode,served_model:model,request_count:requests,retry_count:retries,input_tokens:input,output_tokens:output,duration_ms:Date.now()-begin,usage_complete:usageComplete}
        if(await rpc('complete_historical_jev_v11_task',{p_run_id:run.id,p_worker_id:worker,p_task_id:task.id,p_values:values})!==true)throw new Error('REPORT_LEASE_LOST');processed++;log('V11_JEV_TASK_COMPLETED',{review_alias:task.review_alias,kind:task.kind,repeat:task.repeat,error_code:errorCode,model})
      }))
      const failed=outcomes.find(o=>o.status==="rejected");if(failed?.status==="rejected")throw failed.reason
    }
    await refresh()
    if(processed){await metric('jev_elapsed',{duration_ms:Date.now()-started});await checkpoint({locked_by:null,lease_until:null,attempt_count:0,last_error:null,error_code:null});return {generation_id:run.generation_id,status:'running',cursor:run.cursor}}
    const {data:tasks,error:te}=await admin.from('historical_jev_analysis_tasks').select('*').eq('run_id',run.id).eq('organization_id',run.organization_id).limit(1000);if(te||!tasks)throw new Error('REPORT_RUN_READ_FAILED');if(tasks.some(t=>t.status==='pending'||t.status==='running'))throw new Error('REPORT_V11_TASKS_PENDING')
    const derived=deriveV11(run.snapshot.reviews,tasks as V9Task[]);await checkpoint({findings:derived.findings,classifications:derived.classifications})
    let m=await readMetrics();const beginNarrative=Date.now()
    if(m.narrative_state==='pending'){
      if(!Deno.env.get('OPENAI_API_KEY')?.trim())await metric('narrative_finish',{success:false,result:null,error_code:'AI_NOT_CONFIGURED',duration_ms:0,usage_complete:true})
      else {await metric('narrative_begin');let usageRecorded=false;try{const raw=await writeV9Narrative(v9NarrativeContext(derived,run.snapshot.reviews,run.snapshot.base,run.language),run.language,async u=>{await metric('narrative_usage',{...u});usageRecorded=true});await metric('narrative_finish',{success:true,result:raw,error_code:null,duration_ms:Date.now()-beginNarrative,usage_complete:true})}catch(e){await metric('narrative_finish',{success:false,result:null,error_code:safe(e),duration_ms:Date.now()-beginNarrative,usage_complete:usageRecorded});log('V11_NARRATIVE_FALLBACK',{error_code:safe(e)})}}
    }else if(m.narrative_state==='attempted')await metric('narrative_finish',{success:false,result:null,error_code:'NARRATIVE_INTERRUPTED_UNCONFIRMED',duration_ms:0,usage_complete:m.sol_narrative_input_tokens>0||m.sol_narrative_output_tokens>0})
    m=await readMetrics();await refresh();const elapsed=run.started_at?Date.now()-Date.parse(run.started_at):null,cost=v11Costs(m,elapsed),report=assembleV9Narrative(derived,run.snapshot.base,run.language,m.narrative_state==='completed'?m.narrative_result:null)
    const {data:source,error:se}=await admin.from('historical_report_runs').select('generation_id,input_tokens,output_tokens,started_at,completed_at,findings,snapshot').eq('generation_id',FIRST_V11_SOURCE).eq('organization_id',run.organization_id).single();if(se||!source)throw new Error('REPORT_RUN_READ_FAILED')
    const {data:reference10,error:referenceError}=await admin.from('historical_report_runs').select('generation_id,findings,snapshot').eq('generation_id',FIRST_V11_COMPARISON).eq('organization_id',run.organization_id).eq('status','completed').single();if(referenceError||!reference10)throw new Error('REPORT_RUN_READ_FAILED')
    const comparison=compareV11Sources(source as V11ComparisonSource,reference10 as V11ComparisonSource,run.snapshot.reviews,derived,cost,run.snapshot.calibration_audit),generated=new Date().toISOString(),{analysis_input_stats,...base}=run.snapshot.base
    const publication={...base,generation_id:run.generation_id,analytical_positive_count:derived.metrics.positive,analytical_negative_count:derived.metrics.negative,consultant_report:{...report,version:11,analysis_engine:'jev_hybrid_human_aligned',analysis_input_stats,structured_context_stats:structuredContextStats(run.snapshot.reviews),cross_rating_analysis:derived.cross_rating_analysis,human_aligned_analysis_pipeline:{...cost,...V11_CONFIG,source_generation_id:FIRST_V11_SOURCE,source_snapshot_sha256:run.snapshot.source_snapshot_sha256,unavailable_theme_reviews:derived.unavailable_theme_reviews,review_status:derived.review_status},v11_comparison:comparison},ai_overall_summary:report.conclusion,ai_historical_summary:report.conclusion,ai_status:'completed',ai_error:null,ai_model:'gpt-6.1-sol',ai_input_tokens:m.sol_narrative_input_tokens,ai_output_tokens:m.sol_narrative_output_tokens,ai_total_tokens:m.sol_narrative_input_tokens+m.sol_narrative_output_tokens,ai_call_count:m.sol_narrative_calls,ai_cost_usd:cost.total_estimated_cost_usd,accepted_findings_count:derived.findings.length,rejected_findings_count:0,processed_batches_count:0,token_usage_complete:m.usage_complete,generated_at:generated,updated_at:generated}
    await checkpoint({snapshot:{...run.snapshot,publication}});return await publish(publication)
  }catch(e){const code=safe(e);if(code==='REPORT_LEASE_LOST')return {generation_id:run.generation_id,status:'lease_lost'};log('V11_REPORT_FAILED',{error_code:code});try{await refresh();const policy=historicalRetry(new Error(code==='REPORT_V11_NETWORK_ERROR'?'REPORT_NETWORK_ERROR':code),run.attempt_count);await checkpoint({status:policy.status,last_error:code,error_code:code,next_retry_at:policy.status==='retry'?new Date(Date.now()+policy.delay*1000).toISOString():null,locked_by:null,lease_until:null})}catch{/* Source and paid task ledger remain intact. */}return {generation_id:run.generation_id,status:'failed',error:code}}
}




