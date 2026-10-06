import {createClient} from 'npm:@supabase/supabase-js@2.117.2'
import {processEnglishJob,type EnglishJob} from '../_shared/english-backfill.ts'
import {json} from '../_shared/cors.ts'
Deno.serve(async request=>{
  if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405)
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}})
  const {data:allowed,error}=await admin.rpc('verify_review_scheduler_token',{p_token:request.headers.get('x-home-reviews-scheduler')??''})
  if(error || allowed!==true)return json({error:'UNAUTHORIZED'},401)
  const {data:jobs,error:claimError}=await admin.rpc('claim_english_translation_backfill_jobs',{p_worker:crypto.randomUUID()})
  if(claimError)return json({error:'ENGLISH_JOB_CLAIM_FAILED'},500)
  for(const job of jobs as EnglishJob[]??[])await processEnglishJob(admin,job,Deno.env.get('APIFY_API_TOKEN')??'')
  return json({claimed:jobs?.length??0})
})
