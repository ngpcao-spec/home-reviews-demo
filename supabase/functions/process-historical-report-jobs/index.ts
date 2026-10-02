import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { json } from '../_shared/cors.ts'
import { processHistoricalRun, type HistoricalJob } from '../_shared/historical-report-worker.ts'
import { HISTORICAL_REPORT_CONCURRENCY } from '../_shared/historical-report-policy.ts'

Deno.serve(async request => {
  if (request.method !== 'POST') return json({error:'METHOD_NOT_ALLOWED'},405)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}})
  const {data:authorized,error:authError} = await admin.rpc('verify_review_scheduler_token',{
    p_token:request.headers.get('x-home-reviews-scheduler') ?? '',
  })
  if (authError || authorized !== true) return json({error:'UNAUTHORIZED'},401)
  const worker = crypto.randomUUID()
  const {data:jobs,error} = await admin.rpc('claim_historical_report_jobs',{p_worker_id:worker,p_limit:HISTORICAL_REPORT_CONCURRENCY})
  if (error) { console.error('HISTORICAL_CLAIM_FAILED'); return json({error:'HISTORICAL_CLAIM_FAILED'},500) }
  const results = await Promise.all((jobs as HistoricalJob[] ?? []).map(run=>processHistoricalRun(admin,run,worker)))
  return json({claimed:results.length,results})
})
