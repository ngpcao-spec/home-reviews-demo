import { assertMembership, requireUser } from '../_shared/auth.ts'
import { json, preflight } from '../_shared/cors.ts'
import { enforceRateLimit } from '../_shared/rate-limit.ts'
import { historicalRunStatus } from '../_shared/historical-run-status.ts'
import { newHistoricalModel } from '../_shared/historical-model.ts'
import { CONSULTANT_VERSION } from '../_shared/consultant-contract.ts'

// This endpoint only enqueues. No provider/AI call and no review pagination.
Deno.serve(async request => {
  const early=preflight(request)
  if(early) return early
  if(request.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405)
  try {
    const context=await requireUser(request)
    const body=await request.json()
    if(typeof body.establishment_id!=='string') return json({error:'ESTABLISHMENT_ID_REQUIRED'},400)
    const [{data:e,error:ee},{data:profile,error:pe}]=await Promise.all([
      context.client.from('establishments').select('id,organization_id').eq('id',body.establishment_id).single(),
      context.client.from('profiles').select('preferred_language').eq('user_id',context.user.id).single(),
    ])
    if(ee || !e) return json({error:'ESTABLISHMENT_NOT_FOUND'},404)
    await assertMembership(context.client,context.user.id,e.organization_id,['owner','admin','manager'])
    if(pe || !['fr','vi'].includes(profile?.preferred_language)) return json({error:'PREFERRED_LANGUAGE_REQUIRED'},400)
    if(body.preferred_language && body.preferred_language!==profile.preferred_language) return json({error:'REPORT_LANGUAGE_CHANGED'},409)
    // Older clients may still send continuation calls: they become read-only.
    if(body.generation_id) {
      const {data:run,error}=await context.admin.from('historical_report_runs').select('*').eq('organization_id',e.organization_id)
        .eq('establishment_id',e.id).eq('language',profile.preferred_language).eq('generation_id',body.generation_id).maybeSingle()
      if(error) throw new Error('REPORT_RUN_READ_FAILED')
      if(!run) return json({error:'REPORT_GENERATION_CHANGED'},409)
      if(run.status==='completed') {
        const {data:report,error:re}=await context.client.from('historical_establishment_reports').select('*').eq('establishment_id',e.id).eq('preferred_language',profile.preferred_language).maybeSingle()
        if(re) throw new Error('REPORT_READ_FAILED')
        return json({report,run:historicalRunStatus(run)})
      }
      return json({pending:['queued','running','retry'].includes(run.status),...historicalRunStatus(run),run:historicalRunStatus(run)})
    }
    enforceRateLimit('historical-enqueue:'+context.user.id,30,60_000)
    if(body.first_v7===true) {
      const {data:run,error}=await context.admin.rpc('enqueue_first_v7_report',{p_establishment_id:e.id,p_organization_id:e.organization_id,p_user_id:context.user.id,p_language:profile.preferred_language})
      if(error || !run){const code=['ENGLISH_COVERAGE_REQUIRED','REPORT_OTHER_VERSION_RUNNING','FORBIDDEN'].find(code=>error?.message.includes(code));return json({error:code??'REPORT_ENQUEUE_FAILED'},code==='FORBIDDEN'?403:code?409:500)}
      return json({pending:run.status!=='completed',run:historicalRunStatus(run)},run.status==='completed'?200:202)
    }
    const {data:run,error}=await context.admin.rpc('enqueue_historical_report',{
      p_establishment_id:e.id,p_organization_id:e.organization_id,p_user_id:context.user.id,p_language:profile.preferred_language,p_model:newHistoricalModel(),p_analysis_version:CONSULTANT_VERSION,
    })
    if(error || !run) throw new Error('REPORT_ENQUEUE_FAILED')
    return json({pending:true,...historicalRunStatus(run),run:historicalRunStatus(run)},202)
  } catch(error) {
    const code=error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)?error.message:'REPORT_ENQUEUE_FAILED'
    console.warn('HISTORICAL_ENQUEUE_FAILED',{code})
    return json({error:code},code==='UNAUTHORIZED'?401:code==='FORBIDDEN'?403:code==='RATE_LIMITED'?429:500)
  }
})
