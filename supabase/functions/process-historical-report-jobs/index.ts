import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { json } from '../_shared/cors.ts'
import { processHistoricalRun, type HistoricalJob } from '../_shared/historical-report-worker.ts'
import { HISTORICAL_REPORT_CONCURRENCY } from '../_shared/historical-report-policy.ts'
import {processCurrentReportPreparation,currentReportProtocol,CURRENT_REPORT_CODE} from '../_shared/current-report-v2.ts'
import {CURRENT_V2,verifyParallelProtocol} from '../_shared/parallel-report.ts'
import {currentBatchManifest,CURRENT_BATCH_VERSION} from '../_shared/current-batch-report.ts'
import {localHybridTokens} from '../_shared/jev-hybrid-evidence.ts'
import {currentHistoricalStatus} from '../_shared/current-report-status.ts'
import {SUPPORTED_EVIDENCE_SELECTORS} from '../_shared/report-evidence-selector.ts'

Deno.serve(async request => {
  if (request.method !== 'POST') return json({error:'METHOD_NOT_ALLOWED'},405)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}})
  const {data:authorized,error:authError} = await admin.rpc('verify_review_scheduler_token',{
    p_token:request.headers.get('x-home-reviews-scheduler') ?? '',
  })
  if (authError || authorized !== true) return json({error:'UNAUTHORIZED'},401)
  const payload=await request.json().catch(()=>null)
  // Explicit read-only deployment probes return before claiming any job.
  if(payload?.mode==='current_report_capability'){
    const r=await admin.from('report_pipeline_settings').select('engine,jev_transport,evidence_selector_version,updated_at').eq('id',true).single()
    return json({version:CURRENT_V2,batch_version:CURRENT_BATCH_VERSION,code:CURRENT_REPORT_CODE,selectors_supported:SUPPORTED_EVIDENCE_SELECTORS,request_selector_sha256_pinned:true,routing:r.data,provider_calls:0,new_runs:0})
  }
  if(payload?.mode==='current_report_status_probe'){
    const r=await admin.from('historical_report_runs').select('*').eq('id',payload.source_run_id).single()
    if(r.error)return json({error:'SOURCE_NOT_AVAILABLE',provider_calls:0},409)
    return json({run:await currentHistoricalStatus(admin,r.data),provider_calls:0,new_runs:0})
  }
  if(payload?.mode==='current_report_probe'){
    const at=performance.now(),r=await admin.from('historical_report_runs').select('*').eq('id',payload.source_run_id).eq('status','completed').single()
    if(r.error)return json({error:'SOURCE_NOT_AVAILABLE',provider_calls:0},409)
    const p=await currentReportProtocol({...r.data,engine:'jev_sol_v2',request_id:crypto.randomUUID()} as HistoricalJob)
    await verifyParallelProtocol(p.body,p.sha256)
    if(payload.transport==='batch_initial_v1'){
      const b=await currentBatchManifest(p,localHybridTokens)
      return json({version:CURRENT_BATCH_VERSION,provider_calls:0,new_runs:0,batches:b.body.plans.map(b=>({number:b.number,reviews:b.reviews,request_sha256:b.request_sha256,preflight:b.preflight})),configuration:b.body.configuration,wall_ms:performance.now()-at})
    }
    return json({version:CURRENT_V2,code:CURRENT_REPORT_CODE,provider_calls:0,new_runs:0,new_consents:0,denominators:p.body.denominators,configuration_sha256:p.body.classification_configuration_sha256,selector:p.body.configuration.evidence_selector,wire:p.body.configuration.sol_wire_version,max_luna_calls:p.body.max_luna_calls,max_sol_calls:p.body.max_sol_calls,wall_ms:performance.now()-at,memory:Deno.memoryUsage()})
  }
  const worker = crypto.randomUUID()
  const {data:jobs,error} = await admin.rpc('claim_historical_report_jobs',{p_worker_id:worker,p_limit:HISTORICAL_REPORT_CONCURRENCY})
  if (error) { console.error('HISTORICAL_CLAIM_FAILED'); return json({error:'HISTORICAL_CLAIM_FAILED'},500) }
  const list=jobs as HistoricalJob[]??[];
  const bindings=list.length?await admin.from('report_generation_requests').select('id,source_run_id,engine,jev_transport,shared_jev_version,evidence_selector_version,evidence_selector_sha256,comparison_id').in('source_run_id',list.map(r=>r.id)):{data:[],error:null};
  if(bindings.error)return json({error:'CURRENT_REPORT_BINDING_UNAVAILABLE'},500);
  const results = await Promise.all(list.map(run=>{const b=bindings.data?.find(b=>b.source_run_id===run.id);return b?.engine==='jev_sol_v2'?processCurrentReportPreparation(admin,{...run,engine:b.engine,jev_transport:b.jev_transport,shared_jev_version:b.shared_jev_version,evidence_selector_version:b.evidence_selector_version,evidence_selector_sha256:b.evidence_selector_sha256,request_id:b.id,v2_report_id:b.comparison_id},worker):processHistoricalRun(admin,{...run,...(b?{request_id:b.id}:{} )},worker)}))
  return json({claimed:results.length,results})
})
