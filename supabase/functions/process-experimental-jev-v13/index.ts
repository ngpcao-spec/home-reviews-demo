import {createClient} from 'npm:@supabase/supabase-js@2.117.2'
import {json} from '../_shared/cors.ts'
import {processV13} from '../_shared/jev-v13-worker.ts'
import type {V13Run} from '../_shared/jev-v13-core.ts'
Deno.serve(async request=>{if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}}),{data:allowed,error}=await admin.rpc('verify_review_scheduler_token',{p_token:request.headers.get('x-home-reviews-scheduler')??''});if(error||allowed!==true)return json({error:'UNAUTHORIZED'},401);const worker=crypto.randomUUID(),{data:run,error:ce}=await admin.rpc('claim_experimental_v13_run',{p_worker:worker});if(ce)return json({error:'V13_CLAIM_FAILED'},500);return json(run?await processV13(admin,run as V13Run,worker):{claimed:0})})
