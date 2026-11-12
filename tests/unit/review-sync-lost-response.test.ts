// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
vi.mock('../../supabase/functions/_shared/recent-review-policy.ts',()=>({assertIngestionAllowed:vi.fn(async()=>{})}));
vi.mock('../../supabase/functions/_shared/sync-service.ts',()=>({apifyToken:()=> 'SYNTHETIC',providerName:()=> 'apify',insertReviews:vi.fn(),reviewIngestionBundle:vi.fn(),fetchIncrementalPage:vi.fn(),persistEstablishmentSnapshot:vi.fn(),preferredLanguageForOrganization:vi.fn()}));
beforeEach(()=>vi.stubGlobal('Deno',{env:{get:()=>undefined},serve:vi.fn()}));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const config={leaseSeconds:240,providerLeaseSeconds:60,providerCooldownMs:200,providerSlotWaitMs:2000};
function fixture(checkpointFails=false){
 const frozen={collection_language:'vi' as const,provider_start_attempted_at:null as string|null,apify_run_id:null as string|null,apify_dataset_id:null as string|null,incremental_version:null as string|null,incremental_build:null as string|null,incremental_input:null as Record<string,unknown>|null};
 const job=()=>({id:'test-job',establishment_id:'test-establishment',organization_id:'test-org',...frozen,attempts:1,pagination_cursor:null,checkpoint_review_id:'known',checkpoint_review_at:'2026-10-28T12:00:00Z',head_review_id:null,head_review_at:null,google_id:'123',google_maps_url:'https://www.google.com/maps?cid=123'});
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>{
  if(name==='claim_review_provider_slot')return {data:1,error:null};
  if(name==='fail_review_sync_job')return {data:'dead',error:null};
  if(name==='reserve_incremental_review_sync'){Object.assign(frozen,{provider_start_attempted_at:new Date().toISOString(),incremental_input:args.p_input,incremental_build:args.p_build,incremental_version:'google-reviews-incremental-v1'});}
  if(name==='checkpoint_review_sync_job'){
   if(checkpointFails)return {data:null,error:{message:'SIMULATED_DATABASE_FAILURE'}};
   const cursor=JSON.parse(String(args.p_pagination_cursor));Object.assign(frozen,{apify_run_id:cursor.runId,apify_dataset_id:cursor.datasetId});
  }
  return {data:true,error:null};
 });
 const query={select:()=>query,eq:()=>query,single:async()=>({data:{...frozen},error:null})};
 return {frozen,job,rpc,admin:{from:()=>query,rpc} as unknown as SupabaseClient};
}
it('accepted launch with lost response remains reserved; a second worker never POSTs again',async()=>{
 const {processJob}=await import('../../supabase/functions/process-review-sync-jobs/index');
 const f=fixture();const acceptedRuns:string[]=[];
 const network=vi.fn(async()=>{acceptedRuns.push('accepted-but-response-lost');throw new TypeError('connection reset');});vi.stubGlobal('fetch',network);
 const fullConfig={...config,maxPages:5,maxAttempts:5,backoffSeconds:60};
 await expect(processJob(f.admin,f.job(),'worker-1',fullConfig)).resolves.toMatchObject({status:'dead',error:'APIFY_START_OUTCOME_UNKNOWN'});
 expect(f.frozen.provider_start_attempted_at).not.toBeNull();expect(f.frozen.apify_run_id).toBeNull();
 await expect(processJob(f.admin,f.job(),'worker-2',fullConfig)).resolves.toMatchObject({status:'dead',error:'APIFY_START_OUTCOME_UNKNOWN'});
 expect(acceptedRuns).toHaveLength(1);expect(network).toHaveBeenCalledTimes(1);
 expect(f.rpc.mock.calls.filter(([name])=>name==='fail_review_sync_job').every(([,args])=>args.p_retryable===false)).toBe(true);
 expect(f.rpc.mock.calls.some(([name])=>name==='commit_incremental_review_sync')).toBe(false);
});
it('a received run followed by failed database checkpoint also cannot start a second extraction',async()=>{
 const {processApifyJob}=await import('../../supabase/functions/process-review-sync-jobs/index');
 const logged=vi.spyOn(console,'info');
 const f=fixture(true);const network=vi.fn(async()=>new Response(JSON.stringify({data:{id:'accepted-run',defaultDatasetId:'dataset',status:'RUNNING'}})));vi.stubGlobal('fetch',network);
 await expect(processApifyJob(f.admin,f.job(),'worker-1',config)).rejects.toThrow('SIMULATED_DATABASE_FAILURE');
 await expect(processApifyJob(f.admin,f.job(),'worker-2',config)).rejects.toThrow('APIFY_START_OUTCOME_UNKNOWN');
 expect(network).toHaveBeenCalledTimes(1);expect(f.frozen.apify_run_id).toBeNull();
 expect(logged).toHaveBeenCalledWith('REVIEW_SYNC_APIFY_START_RECEIVED',{job_id:'test-job',run_id:'accepted-run',dataset_id:'dataset'});
});
it('records a safe authentication cause while retaining the unknown outcome and disabling retry',async()=>{
 const {processJob}=await import('../../supabase/functions/process-review-sync-jobs/index');
 const f=fixture();const logged=vi.spyOn(console,'warn');vi.stubGlobal('fetch',vi.fn(async()=>new Response('not authorized',{status:401})));
 const result=await processJob(f.admin,f.job(),'worker-1',{...config,maxPages:5,maxAttempts:5,backoffSeconds:60});
 expect(result).toMatchObject({status:'dead',error:'APIFY_START_OUTCOME_UNKNOWN'});
 expect(logged).toHaveBeenCalledWith('REVIEW_SYNC_APIFY_START_UNRESOLVED',{job_id:'test-job',cause_code:'APIFY_AUTH_ERROR',mapped_http_status:502});
 expect(f.rpc).toHaveBeenCalledWith('fail_review_sync_job',expect.objectContaining({p_retryable:false,p_error_code:'APIFY_START_OUTCOME_UNKNOWN'}));
 expect(JSON.stringify(logged.mock.calls)).not.toContain('SYNTHETIC');
});
it('a verified existing run attached to the same reservation resumes by GET only',async()=>{
 const {processApifyJob}=await import('../../supabase/functions/process-review-sync-jobs/index');
 const f=fixture();Object.assign(f.frozen,{provider_start_attempted_at:'2026-10-29T00:00:00Z',apify_run_id:'existing-run',apify_dataset_id:'existing-dataset'});
 const network=vi.fn(async(url:string,init?:RequestInit)=>{expect(url).toContain('/actor-runs/existing-run');expect(init?.method??'GET').toBe('GET');return new Response(JSON.stringify({data:{id:'existing-run',defaultDatasetId:'existing-dataset',status:'RUNNING'}}));});vi.stubGlobal('fetch',network);
 await expect(processApifyJob(f.admin,f.job(),'worker-1',config)).resolves.toMatchObject({status:'provider_running',providerRequests:0});
 expect(network).toHaveBeenCalledTimes(1);expect(f.rpc.mock.calls.some(([name])=>name==='reserve_incremental_review_sync')).toBe(false);
});
