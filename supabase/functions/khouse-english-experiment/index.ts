import {createClient} from 'npm:@supabase/supabase-js@2.117.2'
import {json} from '../_shared/cors.ts'
import {isolatedEnglishStep,type ExperimentPort} from './runner.ts'
declare const EdgeRuntime:{waitUntil(p:Promise<unknown>):void}
Deno.serve(async request=>{
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405)
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}})
 const auth=await admin.rpc('verify_review_scheduler_token',{p_token:request.headers.get('x-home-reviews-scheduler')??''})
 if(auth.error||auth.data!==true)return json({error:'UNAUTHORIZED'},401)
 try{
  const body=await request.json()
  if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.experiment_id??''))throw Error('EXPERIMENT_ID_INVALID')
  const rpc=async(name:string,args:Record<string,unknown>)=>{const r=await admin.rpc(name,args);if(r.error)throw Error('EXPERIMENT_RPC_FAILED');return r.data}
  const port:ExperimentPort={read:id=>rpc('kh_en_read',{p_id:id}),claim:(id,phase,worker)=>rpc('kh_en_claim',{p_id:id,p_phase:phase,p_worker:worker}),receive:(id,phase,worker,receipt)=>rpc('kh_en_receive',{p_id:id,p_phase:phase,p_worker:worker,p_receipt:receipt}),artifact:(id,key,value)=>rpc('kh_en_artifact',{p_id:id,p_key:key,p_value:value})}
  const work=()=>isolatedEnglishStep(port,body.experiment_id,body.action,{apify:Deno.env.get('APIFY_API_TOKEN')??'',jev:Deno.env.get('TYPESAFE_API_KEY')??'',sol:Deno.env.get('OPENAI_API_KEY')??''},fetch)
  if(body.action==='capability')return json(await work())
  EdgeRuntime.waitUntil(work().catch(e=>console.error('KH_EN_STEP_STOPPED_NO_RETRY',e instanceof Error?e.message:'EXPERIMENT_FAILED')))
  return json({accepted:true,experiment_only:true,automatic_retry:false},202)
 }catch{return json({error:'EXPERIMENT_REQUEST_INVALID'},400)}
})
