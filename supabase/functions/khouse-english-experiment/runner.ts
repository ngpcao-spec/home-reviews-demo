// Isolated, manually dispatched experiment. Never calls a production worker,
// ingestion RPC, publication RPC, translation model, or automatic retry.
import {analysisTextSha256} from '../_shared/analysis-text.ts'
type Call={phase:string;state:string;request_wire:string;request_sha256:string;attempts:number;receipt?:{raw_response_text?:string;http_status?:number}}
type Experiment={id:string;armed:boolean;expires_at:string;artifacts:Record<string,any>}
export interface ExperimentPort {
 read(id:string):Promise<{experiment:Experiment;calls:Call[]}>;
 claim(id:string,phase:string,worker:string):Promise<Call|null>;
 receive(id:string,phase:string,worker:string,receipt:Record<string,unknown>):Promise<boolean>;
 artifact(id:string,key:string,value:unknown):Promise<boolean>;
}
export async function isolatedEnglishStep(port:ExperimentPort,id:string,action:string,keys:{apify:string;jev:string;sol:string},http:typeof fetch){
 const saved=await port.read(id),e=saved.experiment
 if(action==='capability')return {provider_calls:0,apify:!!keys.apify,jev:!!keys.jev,sol:!!keys.sol,automatic_retry:false}
 if(!e.armed||Date.parse(e.expires_at)<=Date.now())throw Error('EXPERIMENT_DISARMED_OR_EXPIRED')
 if(action==='apify_status'||action==='apify_dataset'){
  if(!keys.apify)throw Error('EXPERIMENT_SERVER_ACCESS_MISSING')
  const receipt=saved.calls.find(c=>c.phase==='apify')?.receipt
  if(!receipt?.raw_response_text||receipt.http_status!==201&&receipt.http_status!==200)throw Error('APIFY_START_NOT_KNOWN')
  const started=JSON.parse(receipt.raw_response_text).data
  if(!/^[A-Za-z0-9]+$/.test(started?.id??'')||!/^[A-Za-z0-9]+$/.test(started?.defaultDatasetId??''))throw Error('APIFY_IDENTITY_INVALID')
  if(action==='apify_dataset'&&e.artifacts.apify_status?.body?.data?.status!=='SUCCEEDED')throw Error('APIFY_NOT_COMPLETED')
  const path=action==='apify_status'?'/actor-runs/'+started.id+'?waitForFinish=20':'/datasets/'+started.defaultDatasetId+'/items?clean=true&format=json&limit=1000'
  const at=Date.now(),response=await http('https://api.apify.com/v2'+path,{headers:{Authorization:'Bearer '+keys.apify},redirect:'error',signal:AbortSignal.timeout(30000)})
  const raw=(await response.text()).replaceAll(keys.apify,'[REDACTED_SECRET]')
  const value={http_status:response.status,duration_ms:Date.now()-at,observed_at:new Date().toISOString(),body:JSON.parse(raw)}
  if(!await port.artifact(id,action,value))throw Error('EXPERIMENT_READ_SAVE_FAILED')
  return {provider_calls:0,provider_reads:1,action,http_status:response.status}
 }
 if(!['apify','jev_1','jev_2','jev_3','sol'].includes(action))throw Error('EXPERIMENT_ACTION_INVALID')
 const call=saved.calls.find(c=>c.phase===action)
 if(!call)throw Error('EXPERIMENT_REQUEST_NOT_PREPARED')
 if(call.attempts!==0||call.state!=='prepared')return {provider_calls:0,consumed:true}
 const key=action==='apify'?keys.apify:action==='sol'?keys.sol:keys.jev
 if(!key)throw Error('EXPERIMENT_SERVER_ACCESS_MISSING')
 if(await analysisTextSha256(call.request_wire)!==call.request_sha256)throw Error('EXPERIMENT_REQUEST_CHANGED')
 const request=JSON.parse(call.request_wire)
 if(action==='apify'){
  if(request.language!=='en'||request.maxReviews!==300||request.reviewsSort!=='newest'||request.reviewsOrigin!=='google'||request.startUrls?.length!==1||request.startUrls[0].url!=='https://www.google.com/maps?cid=10272778536914778056')throw Error('EXPERIMENT_APIFY_SCOPE_CHANGED')
 }else if(action==='sol'){
  if(request.model!=='gpt-6.1-sol'||request.reasoning?.effort!=='low'||request.max_output_tokens!==9500)throw Error('EXPERIMENT_SOL_CONFIGURATION_CHANGED')
 }else if(request.model!=='jev-1.13.0')throw Error('EXPERIMENT_JEV_MODEL_CHANGED')
 const worker=crypto.randomUUID(),claimed=await port.claim(id,action,worker)
 if(!claimed)return {provider_calls:0,concurrent_or_consumed:true}
 if(claimed.request_sha256!==call.request_sha256||claimed.request_wire!==call.request_wire)throw Error('EXPERIMENT_RESERVED_REQUEST_CHANGED')
 const url=action==='apify'?'https://api.apify.com/v2/acts/compass~google-maps-reviews-scraper/runs':action==='sol'?'https://api.openai.com/v1/responses':'https://api.typesafe.ai/v1/systemone'
 const at=Date.now();let receipt:Record<string,unknown>
 try{
  const response=await http(url,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:call.request_wire,redirect:'error',signal:AbortSignal.timeout(action==='sol'?110000:action==='apify'?30000:110000)})
  const raw=(await response.text()).replaceAll(key,'[REDACTED_SECRET]')
  receipt={request_sha256:call.request_sha256,raw_response_text:raw,raw_response_sha256:await analysisTextSha256(raw),http_status:response.status,duration_ms:Date.now()-at,provider_request_id:response.headers.get('x-request-id'),error:null}
 }catch{
  receipt={request_sha256:call.request_sha256,raw_response_text:null,http_status:null,duration_ms:Date.now()-at,error:'PROVIDER_OUTCOME_UNKNOWN_NO_RETRY'}
 }
 if(!await port.receive(id,action,worker,receipt))throw Error('EXPERIMENT_RECEIPT_SAVE_UNCERTAIN_NO_RETRY')
 return {provider_calls:1,action,http_status:receipt.http_status,outcome:receipt.raw_response_text===null?'unknown':'received'}
}
