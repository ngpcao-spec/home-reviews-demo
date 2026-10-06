import { requireUser,assertMembership } from '../_shared/auth.ts'
import { englishReviews,englishCoverage,englishBackfillLimit } from '../_shared/english-backfill.ts'
const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers})
Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers})
  if(!['GET','POST'].includes(request.method))return json({error:'METHOD_NOT_ALLOWED'},405)
  try {
    const context=await requireUser(request)
    const body=request.method==='POST'?await request.json():Object.fromEntries(new URL(request.url).searchParams)
    if(typeof body.establishment_id!=='string' || !/^[a-f0-9-]{36}$/i.test(body.establishment_id))return json({error:'ESTABLISHMENT_ID_REQUIRED'},400)
    const {data:e,error}=await context.client.from('establishments').select('id,organization_id').eq('id',body.establishment_id).single()
    if(error || !e)return json({error:'ESTABLISHMENT_NOT_FOUND'},404)
    await assertMembership(context.client,context.user.id,e.organization_id,['owner','admin','manager'])
    const readJob=async()=>{const {data,error}=await context.client.from('english_translation_backfill_jobs').select('id,status,created_at,completed_at,error_code,result,provider_requests').eq('establishment_id',e.id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();if(error)throw new Error('ENGLISH_JOB_READ_FAILED');return data}
    const reviews=await englishReviews(context.admin,e.id,e.organization_id),coverage=englishCoverage(reviews),job=await readJob()
    if(request.method==='GET')return json({coverage,job})
    if(job && ['queued','starting','running'].includes(job.status))return json({coverage,job},202)
    if(!coverage.english_translation_missing)return json({coverage,job,already_complete:true})
    if(!Deno.env.get('APIFY_API_TOKEN')?.trim())return json({error:'APIFY_TOKEN_MISSING'},503)
    const {data:created,error:insertError}=await context.admin.from('english_translation_backfill_jobs').insert({organization_id:e.organization_id,establishment_id:e.id,requested_by:context.user.id,status:'queued',targets:reviews.map(r=>({id:r.id,external_review_id:r.external_review_id})),provider_limit:englishBackfillLimit(reviews.length)}).select('id,status,created_at').single()
    if(insertError?.code==='23505')return json({coverage,job:await readJob()},202)
    if(insertError || !created)throw new Error('ENGLISH_JOB_CREATE_FAILED')
    return json({coverage,job:created},202)
  }catch(error){const code=error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)?error.message:'ENGLISH_BACKFILL_FAILED';return json({error:code},code==='UNAUTHORIZED'?401:code==='FORBIDDEN'?403:500)}
})
