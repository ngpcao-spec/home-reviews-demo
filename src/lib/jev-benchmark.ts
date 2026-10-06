import { supabase } from './supabase'

// Temporary experiment: remove the route/menu/page and this module to retire UI.
export const JEV_EXPERIMENT_ENABLED = true
export interface JevSource { establishment_id:string;organization_id:string;name:string;source_generation_id:string;reviews_total:number;completed_at:string;snapshots?:{source_generation_id:string;reviews_total:number;completed_at:string}[] }
export function selectedJevSource(user:string) {try{return localStorage.getItem('jev-benchmark-selection:'+user)??''}catch{return ''}}
export function selectJevSource(user:string,source:string) {try{localStorage.setItem('jev-benchmark-selection:'+user,source)}catch{/* Latest source is the safe default on future visits. */}}
export interface AxisScores { precision_vs_sol_reference:number|null;recall_vs_sol_reference:number|null;f1_vs_sol_reference:number|null }
export interface JevComparison {
  metrics_complete:boolean
  dataset:{reviews_total:number;reviews_with_text:number;textless_review:number}
  jev:{estimated_jev_cost_usd:number;elapsed_ms:number;served_models:string[];multiple_served_models:boolean;input_tokens:number;output_tokens:number}
  sol_v6_baseline:{estimated_sol_baseline_cost_usd:number;end_to_end_elapsed_ms:number}
  overall_sentiment:{pooled_raw_agreement_with_sol_v6:number|null}
  stability:{stable_decision_rate:number|null;max_probability_drift:number|null}
  axes_at_threshold:Record<string,Record<string,{pooled:AxisScores}>>
  verdict:{quality:string;stability:string;cost:string;latency:string;next_step:string}
  errors?:{review_alias:string;repeat:number;error_code:string}[]
}
export interface JevRun { id:string;source_generation_id:string;status:'running'|'completed'|'failed';created_at:string;error_code:string|null;requested_model:string;served_models:string[];repeat_count:number;reviews_total:number;request_count:number;retry_count:number;jev_input_tokens:number;jev_output_tokens:number;comparison:JevComparison }
export interface JevReference { benchmark_id:string|null;created_at:string;pending:boolean }
const key=(user:string,source:string)=>`jev-benchmark:${user}:${source}`
export function readJevReference(user:string,source:string):JevReference|null {
  try {const ref=JSON.parse(localStorage.getItem(key(user,source))??'null');return ref && typeof ref.created_at==='string' && (ref.benchmark_id===null || typeof ref.benchmark_id==='string')?ref:null}catch{return null}
}
export function saveJevReference(user:string,source:string,ref:JevReference) {
  // Refuse a launch if durable storage is unavailable: a reload must remain safe.
  localStorage.setItem(key(user,source),JSON.stringify(ref))
}
export function rememberJevRun(user:string,run:JevRun) {
  try{saveJevReference(user,run.source_generation_id,{benchmark_id:run.id,created_at:run.created_at,pending:false})}catch{/* Server lookup remains authoritative when local storage is unavailable. */}
}
async function invoke<T>(suffix:string,method:'GET'|'POST'='GET',body?:Record<string,unknown>):Promise<T> {
  if(!supabase)throw new Error('UNAUTHORIZED')
  const {data,error}=await supabase.functions.invoke<T>('benchmark-jev-historical-analysis'+suffix,{method,...(body?{body}: {})})
  if(error) {
    let code='JEV_CONNECTION_ERROR'
    const context=(error as {context?:Response}).context
    if(context instanceof Response) {try{const result=await context.clone().json();if(typeof result.error==='string')code=result.error;else if(context.status===401)code='UNAUTHORIZED'}catch{/* Never display vendor/transport bodies. */}}
    throw new Error(code)
  }
  return data as T
}
export const jevApi={
  async access(user:string) {
    if(!supabase || !JEV_EXPERIMENT_ENABLED)return false
    const {data,error}=await supabase.from('organization_members').select('role').eq('user_id',user).in('role',['owner','admin','manager'])
    if(error)throw new Error('JEV_ACCESS_READ_FAILED')
    return Boolean(data?.length)
  },
  async sources(){return (await invoke<{establishments:JevSource[]}>('?eligible=1')).establishments},
  async latest(source:string){return (await invoke<{benchmark:JevRun|null}>('?source_generation_id='+encodeURIComponent(source))).benchmark},
  async read(id:string){return await invoke<JevRun>('?benchmark_id='+encodeURIComponent(id))},
  async post(source:string){return await invoke<{benchmark_id:string}>('','POST',{source_generation_id:source,repeat_count:3,concurrency:8,model:'jev-latest'})},
}
const launchLocks=new Set<string>()
export async function launchJevOnce(user:string,source:string):Promise<JevRun|null> {
  const lock=key(user,source)
  if(launchLocks.has(lock))throw new Error('JEV_LAUNCH_PENDING')
  launchLocks.add(lock)
  async function launch() {
    // Re-check the authoritative state immediately before any explicit POST,
    // including retries of a failed run. Existing completed runs are never replaced.
    const existing=await jevApi.latest(source)
    if(existing && existing.status!=='failed'){rememberJevRun(user,existing);return existing}
    const saved=readJevReference(user,source)
    if(saved?.benchmark_id && !existing) {
      const known=await jevApi.read(saved.benchmark_id)
      if(known.source_generation_id!==source)throw new Error('JEV_LAUNCH_PENDING')
      if(known.status!=='failed'){rememberJevRun(user,known);return known}
    }
    if(saved?.pending)throw new Error('JEV_LAUNCH_PENDING')
    saveJevReference(user,source,{benchmark_id:null,created_at:new Date().toISOString(),pending:true})
    try {
      const result=await jevApi.post(source)
      if(!result?.benchmark_id)throw new Error('JEV_LAUNCH_PENDING')
      saveJevReference(user,source,{benchmark_id:result.benchmark_id,created_at:new Date().toISOString(),pending:false})
      // Keep the durable id even if this read fails or the screen unmounts.
      return await jevApi.read(result.benchmark_id)
    }catch(error) {
      // These definite pre-launch rejections cannot have created a run.
      const code=error instanceof Error?error.message:''
      if(['JEV_NOT_CONFIGURED','UNAUTHORIZED','FORBIDDEN','INVALID_REPEAT_COUNT','INVALID_CONCURRENCY','SOURCE_NOT_FOUND'].includes(code))localStorage.removeItem(lock)
      throw error
    }
  }
  try {
    // Serialize tabs on modern iOS. The in-memory lock covers double taps and
    // remounts; persistent pending marker survives suspension/reload.
    if(navigator.locks)return await navigator.locks.request(lock,launch)
    return await launch()
  }finally{launchLocks.delete(lock)}
}
export function costComparison(jev:number,sol:number) {return sol>0?{share:jev/sol,savings:1-jev/sol}:null}
export function latencyRatio(jevMs:number,solMs:number) {return jevMs>0 && solMs>0?solMs/jevMs:null}
