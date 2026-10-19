// Thin continuation adapter: same frozen request, ReadyPort and validator.
// No new classification, evidence rule, consent or provider retry policy.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {solReadyPort} from './jls-sol-ready-store.ts';
import {processReadySol} from './jls-sol-ready-worker.ts';
import {direct4ReadyContract,type Direct4Ready} from './jls-direct4-execution.ts';
import {direct4MockSolResponse} from './jls-direct4-probe.ts';
export const DIRECT4_CONTINUATION_VERSION='jls-direct4-sol-continuation-v1';
export async function inspectDirect4Continuation(client:SupabaseClient,id:string){
 const port=solReadyPort(client,true),state=await port.load(id);
 await port.active(state);await direct4ReadyContract.verify(state);
 if(!await port.compatible(state))throw Error('DIRECT4_CONTINUATION_SOURCE_OR_CONSENT_INVALID');
 return {version:DIRECT4_CONTINUATION_VERSION,operation_id:id,mode:state.operation.mode,status:state.operation.status,
  request_count:state.operation.request_count,request_sha256:state.ready.body.request_sha256,
  source_run_id:state.operation.run_id,new_provider_calls:0,compatible:true};
}
export async function probeDirect4Continuation(client:SupabaseClient,id:string){
 const port=solReadyPort(client,true),state=await port.load(id);
 if(state.operation.mode!=='mock')throw Error('DIRECT4_PROBE_REQUIRES_MOCK');
 const at=performance.now();let calls=0;
 const http:typeof fetch=async(url,options)=>{
  if(String(url)!=='https://api.openai.com/v1/responses'||options?.body!==state.ready.body.request_json)
   throw Error('DIRECT4_MOCK_REQUEST_CHANGED');
  const reserved=await port.load(id);
  if(reserved.operation.status!=='dispatched'||reserved.operation.request_count!==1)
   throw Error('DIRECT4_MOCK_RESERVATION_REQUIRED');
  calls++;return new Response(JSON.stringify(direct4MockSolResponse(state.ready as unknown as Direct4Ready)));
 };
 const result=await processReadySol(port,id,'EXPLICIT_TECHNICAL_MOCK',http,direct4ReadyContract);
 const saved=await port.load(id);
 return {version:DIRECT4_CONTINUATION_VERSION,explicit_technical_mock:true,provider_calls:0,mock_http_calls:calls,
  wall_ms:performance.now()-at,memory:Deno.memoryUsage(),operation_id:id,outcome:result,
  status:saved.operation.status,receipt_saved:!!saved.operation.receipt,result_saved:!!saved.operation.result};
}
