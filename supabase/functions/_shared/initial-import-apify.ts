import {ApifyError,apifyRunFinished,apifyRunSucceeded,type ApifyRunState} from './apify.ts'
export const INITIAL_IMPORT_POLL_SECONDS=20
export const INITIAL_IMPORT_MAX_POLLS=2
export interface InitialApifyIdentity {provider_run_id:string|null;provider_dataset_id:string|null;provider_start_attempted_at?:string|null}
export interface InitialApifyPort<T> {
 acquire():Promise<boolean>;release():Promise<void>;
 reserveStart():Promise<boolean>;
 start(reserve:()=>Promise<void>):Promise<ApifyRunState>;
 saveRun(run:ApifyRunState):Promise<void>;
 get(runId:string,waitSeconds:number):Promise<ApifyRunState>;
 finished(run:ApifyRunState):Promise<void>;
 retrieve(run:ApifyRunState):Promise<T>;
 defer(seconds:number):Promise<unknown>;
}
/** Bounded server wait on a known run. No sleeps, new run on read error, or browser dependency. */
export async function advanceInitialApify<T>(job:InitialApifyIdentity,port:InitialApifyPort<T>){
 let runId=job.provider_run_id,datasetId=job.provider_dataset_id,run:ApifyRunState|undefined
 if(!runId){
  if(job.provider_start_attempted_at)throw Error('APIFY_START_OUTCOME_UNKNOWN')
  if(datasetId)throw Error('APIFY_PROVIDER_IDENTITY_INCOMPLETE')
  if(!await port.acquire())return port.defer(5)
  try{
   run=await port.start(async()=>{if(!await port.reserveStart())throw Error('APIFY_START_ALREADY_RESERVED')})
   await port.saveRun(run);runId=run.runId;datasetId=run.datasetId
  }finally{await port.release()}
 }
 for(let n=0;n<=INITIAL_IMPORT_MAX_POLLS;n++){
  if(run){
   if(run.runId!==runId||datasetId&&run.datasetId!==datasetId)throw Error('APIFY_PROVIDER_IDENTITY_MISMATCH')
   if(!datasetId){await port.saveRun(run);datasetId=run.datasetId}
   if(apifyRunFinished(run.status)){
    await port.finished(run)
    if(!apifyRunSucceeded(run.status))throw new ApifyError('APIFY_RUN_'+run.status,503)
    return port.retrieve(run)
   }
  }
  if(n===INITIAL_IMPORT_MAX_POLLS)break
  run=await port.get(runId,INITIAL_IMPORT_POLL_SECONDS)
 }
 // Prevent a hot self-dispatch loop if the provider returns RUNNING early.
 return port.defer(5)
}
