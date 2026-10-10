import {createClient} from 'npm:@supabase/supabase-js@2.117.2'
import {json} from '../_shared/cors.ts'
import {processPilot} from '../_shared/jev-pilot-worker.ts'
import type {PilotJob} from '../_shared/jev-pilot-api.ts'
Deno.serve(async request=>{if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}}),{data:allowed,error}=await admin.rpc('verify_review_scheduler_token',{p_token:request.headers.get('x-home-reviews-scheduler')??''});if(error||allowed!==true)return json({error:'UNAUTHORIZED'},401);const worker=crypto.randomUUID(),{data:job,error:ce}=await admin.rpc('claim_economy_pilot_job',{p_worker:worker});if(ce)return json({error:'PILOT_CLAIM_FAILED'},500);return json(job?await processPilot(admin,job as PilotJob,worker):{claimed:0})})
