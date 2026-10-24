import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {requireUser,assertMembership} from '../_shared/auth.ts';
import {json,preflight} from '../_shared/cors.ts';
import {processBatchExperiment,type BatchExperimentPort} from '../_shared/jev-batch-experiment.ts';
import {INITIAL_BATCH_CONTRACT} from '../_shared/jev-review-batches.ts';
import {CURRENT_BATCH_VERSION} from '../_shared/current-batch-report.ts';
import {DIRECT_COVERAGE_VERSION} from '../_shared/jev-direct-evidence-selection.ts';
import {rehearseCurrentBatches} from '../_shared/current-batch-probe.ts';
declare const EdgeRuntime:{waitUntil(p:Promise<unknown>):void};
Deno.serve(async request=>{
 const early=preflight(request);if(early)return early;
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 try{
  const body=await request.json(),admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  if(body.action==='resume'){
   if(typeof body.run_id!=='string')throw Error('BATCH_RUN_REQUIRED');
   const c=await requireUser(request),r=await c.client.from('analysis_jev_batch_runs').select('organization_id').eq('id',body.run_id).single();
   if(r.error)throw Error('FORBIDDEN');await assertMembership(c.client,c.user.id,r.data.organization_id,['owner','admin','manager']);
   const wake=await c.admin.rpc('jev_batch_wake',{p_run:body.run_id});if(wake.error)throw Error('BATCH_RESUME_FAILED');return json({accepted:wake.data!==null,new_authorization:false,retries:0});
  }
  const auth=await admin.rpc('verify_review_scheduler_token',{p_token:request.headers.get('x-home-reviews-scheduler')??''});
  if(auth.error||auth.data!==true)throw Error('UNAUTHORIZED');
  if(body.action==='capability'){
   const s=await admin.from('report_pipeline_settings').select('engine,jev_transport,updated_at').eq('id',true).single();if(s.error)throw Error('BATCH_SETTINGS_READ_FAILED');
   return json({version:CURRENT_BATCH_VERSION,contract:INITIAL_BATCH_CONTRACT,selector:DIRECT_COVERAGE_VERSION,routing:s.data,
    jev_server_access_available:!!Deno.env.get('TYPESAFE_API_KEY'),sol_server_access_available:!!Deno.env.get('OPENAI_API_KEY'),provider_calls:0,new_runs:0});
  }
  if(body.action==='simulate_current')return json(await rehearseCurrentBatches());
  if(typeof body.run_id!=='string')throw Error('BATCH_RUN_REQUIRED');
  const rpc=async(name:string,args:Record<string,unknown>)=>{const r=await admin.rpc(name,args);if(r.error)throw Error(name.toUpperCase()+'_FAILED');return r.data;};
  const port:BatchExperimentPort={
   load:async id=>{const [r,t]=await Promise.all([admin.from('analysis_jev_batch_runs').select('*').eq('id',id).single(),admin.from('analysis_jev_batch_tasks').select('*').eq('run_id',id).order('number')]);if(r.error||t.error)throw Error('BATCH_LOAD_FAILED');return {run:r.data,tasks:t.data};},
   claim:(id,w)=>rpc('jev_batch_claim',{p_run:id,p_worker:w}),
   receive:(t,w,b,s)=>rpc('jev_batch_receive',{p_task:t,p_worker:w,p_receipt:b,p_sha:s}),
   project:(t,w,b,s,e)=>rpc('jev_batch_save_projection',{p_task:t,p_worker:w,p_body:b,p_sha:s,p_error:e??null}),
   envelope:(id,b,s)=>rpc('jev_batch_save_envelope',{p_run:id,p_body:b,p_sha:s}),
   claimSol:(id,w)=>rpc('jev_batch_claim_sol',{p_run:id,p_worker:w}),
   receiveSol:(id,w,b,s)=>rpc('jev_batch_receive_sol',{p_run:id,p_worker:w,p_body:b,p_sha:s}),
   finish:(id,s,b,u,e)=>rpc('jev_batch_finish',{p_run:id,p_status:s,p_result:b,p_usage:u,p_error:e??null}),
  };
  if(body.action==='probe')return json({scope:'experimental_only',new_jev_limit:0,provider_calls:0,default_unchanged:true});
  if(body.action!=='step')throw Error('BATCH_ACTION_INVALID');
  EdgeRuntime.waitUntil(processBatchExperiment(port,body.run_id,{jev:Deno.env.get('TYPESAFE_API_KEY')??'',sol:Deno.env.get('OPENAI_API_KEY')??''},fetch)
   .catch(async e=>{
    const code=e instanceof Error&&/^[A-Z_0-9]+$/.test(e.message)?e.message:'BATCH_STEP_FAILED_NO_RETRY';
    const r=await admin.from('analysis_jev_batch_runs').select('stage').eq('id',body.run_id).single();
    if(r.data?.stage==='prepare_evidence')await rpc('jev_batch_stop',{p_run:body.run_id,p_error:code});
    console.error('BATCH_STEP_STOPPED_RECEIPTS_RETAINED_NO_RETRY',code);
   }));
  return json({accepted:true,automatic_retry:false},202);
 }catch(e){return json({error:e instanceof Error?e.message:'BATCH_REQUEST_FAILED'},409);}
});

