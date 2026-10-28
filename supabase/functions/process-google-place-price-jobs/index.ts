import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {json} from '../_shared/cors.ts';
import {placePriceProvider,processPlacePrice,type PriceJob} from '../_shared/google-place-price.ts';

Deno.serve(async(request)=>{
  if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const auth=await admin.rpc('verify_review_scheduler_token',{p_token:request.headers.get('x-home-reviews-scheduler')??''});
  if(auth.error || auth.data!==true)return json({error:'UNAUTHORIZED'},401);
  const token=Deno.env.get('APIFY_API_TOKEN')?.trim();
  if(!token)return json({error:'PLACE_PRICE_ACCESS_UNAVAILABLE'},503);
  let readyAt=0;try{readyAt=Date.parse((await request.json()).ready_at??'');}catch{/* cron has no body */}
  if(Number.isFinite(readyAt)&&readyAt>Date.now())await new Promise(resolve=>setTimeout(resolve,Math.min(5000,readyAt-Date.now())));
  const worker='place-price:'+crypto.randomUUID();
  const claimed=await admin.rpc('claim_google_place_price_job',{p_worker:worker});
  if(claimed.error)return json({error:'PLACE_PRICE_CLAIM_FAILED'},500);
  const job=claimed.data as PriceJob|null;
  if(!job)return json({claimed:0});
  const result=await processPlacePrice(job,{provider:placePriceProvider(token),action:async(action,data={})=>{
    const r=await admin.rpc('advance_google_place_price_job',{p_job:job.id,p_worker:worker,p_action:action,p_data:data});
    if(r.error)throw Error('PLACE_PRICE_DATABASE_FAILED');
    return r.data===true;
  }});
  return json({claimed:1,job_id:job.id,result});
});
