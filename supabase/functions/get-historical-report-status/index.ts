import { assertMembership, requireUser } from '../_shared/auth.ts'
import { json as baseJson, corsHeaders } from '../_shared/cors.ts'
import { historicalRunStatus } from '../_shared/historical-run-status.ts'
import {compareHistoricalRuns,runSummary} from '../_shared/historical-comparison.ts'
import { FIRST_V8_SOURCE,FIRST_V8_ESTABLISHMENT } from '../_shared/historical-v8.ts'
import {FIRST_V9_SOURCE,FIRST_V9_ESTABLISHMENT,v9Costs,type V9Usage} from '../_shared/historical-v9-core.ts'
import {FIRST_V10_SOURCE,FIRST_V10_ESTABLISHMENT,FIRST_V10_AUDIT,V10_CONFIG,v10Costs,type V10Usage} from '../_shared/historical-v10-core.ts'
const json=(body:unknown,status=200)=>{const response=baseJson(body,status);response.headers.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');return response}

// Read-only projection. Never expose the private snapshot/findings or mutate a run.
Deno.serve(async request => {
  if(request.method==='OPTIONS')return new Response('ok',{headers:{...corsHeaders,'Access-Control-Allow-Methods':'GET, POST, OPTIONS'}})
  if (!['POST','GET'].includes(request.method)) return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  try {
    const context = await requireUser(request)
    const body = request.method==='GET'?Object.fromEntries(new URL(request.url).searchParams):await request.json()
    if (typeof body.establishment_id !== 'string') return json({ error: 'ESTABLISHMENT_ID_REQUIRED' }, 400)
    const [{ data: establishment, error }, { data: profile, error: profileError }] = await Promise.all([
      context.client.from('establishments').select('id,organization_id').eq('id', body.establishment_id).single(),
      context.client.from('profiles').select('preferred_language').eq('user_id', context.user.id).single(),
    ])
    if (error || !establishment) return json({ error: 'ESTABLISHMENT_NOT_FOUND' }, 404)
    await assertMembership(context.client, context.user.id, establishment.organization_id, ['owner', 'admin', 'manager'])
    if (profileError || !['fr', 'vi'].includes(profile?.preferred_language)) return json({ error: 'PREFERRED_LANGUAGE_REQUIRED' }, 400)
    if (body.preferred_language && body.preferred_language !== profile.preferred_language) return json({ error: 'REPORT_LANGUAGE_CHANGED' }, 409)
    let read = context.admin.from('historical_report_runs')
      .select('*')
      .eq('organization_id', establishment.organization_id).eq('establishment_id', establishment.id).eq('language', profile.preferred_language)
    if(body.generation_id)read=read.eq('generation_id',body.generation_id)
    if(body.analysis_version!==undefined){if(![7,8,9,10].includes(Number(body.analysis_version)))return json({error:'REPORT_VERSION_INVALID'},400);read=read.eq('snapshot->>analysis_version',String(body.analysis_version))}
    let eligibility=null
    if(Number(body.analysis_version)===10){
      if(establishment.id!==FIRST_V10_ESTABLISHMENT)return json({run:null,eligibility:{available:false}})
      const [source,audit]=await Promise.all([
        context.admin.from('historical_report_runs').select('generation_id,snapshot').eq('generation_id',FIRST_V10_SOURCE).eq('organization_id',establishment.organization_id).eq('establishment_id',establishment.id).eq('status','completed').eq('snapshot->>analysis_version','9').maybeSingle(),
        context.admin.from('analysis_v9_finding_audits').select('id,status,comparison').eq('id',FIRST_V10_AUDIT).eq('source_v9_generation_id',FIRST_V10_SOURCE).eq('organization_id',establishment.organization_id).eq('establishment_id',establishment.id).eq('status','completed').maybeSingle(),
      ]);if(source.error||audit.error)throw new Error('REPORT_BASELINE_READ_FAILED')
      eligibility={available:!!source.data&&!!audit.data,source_generation_id:source.data?.generation_id??null,analysis_input_stats:source.data?.snapshot.base?.analysis_input_stats??null,jev_configured:!!Deno.env.get('TYPESAFE_API_KEY')?.trim(),calibration:V10_CONFIG,audit_summary:audit.data?.comparison??null}
    }
    if(Number(body.analysis_version)===9){
      if(establishment.id!==FIRST_V9_ESTABLISHMENT)return json({run:null,eligibility:{available:false}})
      const {data:source,error:sourceError}=await context.admin.from('historical_report_runs').select('generation_id,snapshot').eq('generation_id',FIRST_V9_SOURCE).eq('organization_id',establishment.organization_id).eq('establishment_id',establishment.id).eq('status','completed').eq('snapshot->>analysis_version','8').maybeSingle();if(sourceError)throw new Error('REPORT_BASELINE_READ_FAILED')
      eligibility={available:!!source,source_generation_id:source?.generation_id??null,analysis_input_stats:source?.snapshot.base?.analysis_input_stats??null,jev_configured:!!Deno.env.get('TYPESAFE_API_KEY')?.trim()}
    }
    if(Number(body.analysis_version)===8){
      if(establishment.id!==FIRST_V8_ESTABLISHMENT)return json({run:null,eligibility:{available:false}})
      const {data:source,error:sourceError}=await context.admin.from('historical_report_runs').select('generation_id,status,snapshot').eq('generation_id',FIRST_V8_SOURCE).eq('organization_id',establishment.organization_id).eq('establishment_id',establishment.id).eq('status','completed').eq('snapshot->>analysis_version','7').maybeSingle()
      if(sourceError)throw new Error('REPORT_BASELINE_READ_FAILED')
      eligibility={available:!!source&&source.snapshot?.base?.analysis_input_stats?.english_analysis_coverage_percent===100,source_generation_id:source?.generation_id??null}
    }
    const { data: run, error: runError } = await read
      .order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle()
    if (runError) throw new Error('REPORT_RUN_READ_FAILED')
    if (!run) return json({ run: null,...(eligibility?{eligibility}:{}) })
    if(![7,8,9,10].includes(Number(body.analysis_version)))return json({ run: historicalRunStatus(run) })
    const rate=(key:string,fallback:number)=>{const value=Number(Deno.env.get(key)??fallback);return Number.isFinite(value)&&value>=0?value:fallback}
    const inputRate=rate('SOL_INPUT_USD_PER_MILLION',2),outputRate=rate('SOL_OUTPUT_USD_PER_MILLION',10)
    if(Number(body.analysis_version)===10){const {data:m,error:me}=await context.admin.from('historical_jev_v10_run_metrics').select('*').eq('run_id',run.id).eq('organization_id',establishment.organization_id).single();if(me)throw new Error('REPORT_RUN_READ_FAILED');return json({eligibility,run:{...historicalRunStatus(run),analysis_version:10,summary:runSummary(run,inputRate,outputRate),usage:v10Costs(m as V10Usage,run.started_at&&run.completed_at?Date.parse(run.completed_at)-Date.parse(run.started_at):null),report:run.status==='completed'?run.snapshot?.publication?.consultant_report??null:null}})}
    if(Number(body.analysis_version)===9){const {data:m,error:me}=await context.admin.from('historical_jev_run_metrics').select('*').eq('run_id',run.id).eq('organization_id',establishment.organization_id).single();if(me)throw new Error('REPORT_RUN_READ_FAILED');return json({eligibility,run:{...historicalRunStatus(run),analysis_version:9,summary:runSummary(run,inputRate,outputRate),usage:v9Costs(m as V9Usage,run.started_at&&run.completed_at?Date.parse(run.completed_at)-Date.parse(run.started_at):null),report:run.status==='completed'?run.snapshot?.publication?.consultant_report??null:null}})}
    if(Number(body.analysis_version)===8)return json({eligibility,run:{...historicalRunStatus(run),analysis_version:8,created_at:run.created_at,summary:runSummary(run,inputRate,outputRate),report:run.status==='completed'?run.snapshot?.publication?.consultant_report??null:null}})
    let comparison=null
    if(run.status==='completed') {
      const {data:baseline,error:baselineError}=await context.admin.from('historical_report_runs').select('*').eq('organization_id',establishment.organization_id).eq('establishment_id',establishment.id).eq('status','completed').eq('snapshot->>analysis_version','6').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle()
      if(baselineError)throw new Error('REPORT_BASELINE_READ_FAILED')
      if(baseline)comparison=compareHistoricalRuns(baseline,run,inputRate,outputRate)
    }
    return json({run:{...historicalRunStatus(run),analysis_version:7,created_at:run.created_at,summary:runSummary(run,inputRate,outputRate)},comparison})
  } catch (error) {
    const code = error instanceof Error && ['UNAUTHORIZED', 'FORBIDDEN'].includes(error.message) ? error.message : 'REPORT_STATUS_UNAVAILABLE'
    console.warn('Historical report status unavailable', { code })
    return json({ error: code }, code === 'UNAUTHORIZED' ? 401 : code === 'FORBIDDEN' ? 403 : 500)
  }
})
