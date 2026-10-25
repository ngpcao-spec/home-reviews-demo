import {createClient} from 'npm:@supabase/supabase-js@2.117.2'
import {json} from '../_shared/cors.ts'
import {processDisplayJob,translateDisplayOriginal,type DisplayJob} from '../_shared/review-display-provider.ts'

Deno.serve(async request=>{
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405)
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}})
 const auth=await admin.rpc('verify_review_scheduler_token',{p_token:request.headers.get('x-home-reviews-scheduler')??''})
 if(auth.error||auth.data!==true)return json({error:'UNAUTHORIZED'},401)
 const worker=`display:${crypto.randomUUID()}`,key=Deno.env.get('OPENAI_API_KEY')?.trim(),deadline=Date.now()+100_000
 let count=0
 try{
  for(let round=0;round<2&&Date.now()<deadline;round++){
   const {data,error}=await admin.rpc('claim_review_display',{p_worker:worker});if(error)throw Error('DISPLAY_CLAIM_FAILED')
   const jobs=(data??[]) as DisplayJob[];if(!jobs.length)break
   await Promise.all(jobs.map(async job=>{
    const args={p_review:job.review_id,p_language:job.language,p_sha:job.source_sha256,p_worker:worker}
    let attempt:string|null=null
    const finish=async(p_result:unknown)=>{const r=await admin.rpc('finish_review_display',{...args,p_result,p_attempt:attempt});if(r.error)throw Error('DISPLAY_SAVE_FAILED')}
    if(!key){await finish({status:'failed',error_code:'TRANSLATION_NOT_CONFIGURED'});return}
    await processDisplayJob(job,{reserve:async()=>{const r=await admin.rpc('reserve_review_display',args);if(r.error)throw Error('DISPLAY_RESERVATION_FAILED');attempt=r.data;return typeof attempt==='string'},finish,translate:(text,target,hint)=>translateDisplayOriginal(text,target,hint,key)})
    count++
   }))
  }
 }catch{console.error('DISPLAY_WORKER_INTERRUPTED');return json({error:'DISPLAY_WORKER_INTERRUPTED'},500)}
 finally{await admin.rpc('wake_review_display_queue')}
 return json({processed:count})
})
