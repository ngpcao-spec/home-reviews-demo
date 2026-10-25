import {createClient} from 'npm:@supabase/supabase-js@2.117.2'
import {processEnglishJob,type EnglishJob} from '../_shared/english-backfill.ts'
import {json} from '../_shared/cors.ts'
Deno.serve(async request=>{
  if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405)
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}})
  const {data:allowed,error}=await admin.rpc('verify_review_scheduler_token',{p_token:request.headers.get('x-home-reviews-scheduler')??''})
  if(error || allowed!==true)return json({error:'UNAUTHORIZED'},401)
  return json({disabled:true,reason:'ENGLISH_BACKFILL_RETIRED',claimed:0,provider_calls:0})
})
