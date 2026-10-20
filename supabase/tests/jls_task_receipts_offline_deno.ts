// Actual saved replies, read-only replay. Run with --deny-net and an explicit
// private state export; no provider transport, authorization or database writes.
import {taskReceiptWire,databasePersistenceRetry} from '../functions/_shared/jls-task-persistence.ts';
import {hybridHash} from '../functions/_shared/jev-hybrid-evidence.ts';
import {negativeHash} from '../functions/_shared/negative-validation-core.ts';
import {parseDirectCategoriesRounded} from '../functions/_shared/jev-direct-categories.ts';
import type {RestaurantState} from '../functions/_shared/jls-restaurant-worker.ts';
const fail=(s:string):never=>{throw Error(s);};
globalThis.fetch=()=>Promise.reject(Error('PROVIDER_NETWORK_FORBIDDEN'));
const data=JSON.parse(await Deno.readTextFile(Deno.args[0])),state:RestaurantState=data.state??data;
let replies=0;
for(const task of state.tasks.filter(t=>t.status==='completed')){
 const a=state.artifacts.find(a=>a.kind==='task:'+task.id)??fail('SAVED_RESULT_MISSING');
 if(await hybridHash(a.body)!==a.sha256)fail('ARTIFACT_CHANGED');
 const b=a.body,raw=b.raw_response_text as string;
 if(await negativeHash(raw)!==b.raw_response_sha256||await hybridHash(task.request)!==task.request_sha256)fail('SOURCE_CHANGED');
 const parsed=parseDirectCategoriesRounded(JSON.parse(raw));
 if(parsed.model!==b.served_model)fail('MODEL_CHANGED');
 const receipt=await taskReceiptWire(state,task,{status:task.status,body:b,sha256:a.sha256},'existing_artifact');
 if(await negativeHash(receipt.wire)!==receipt.sha256||JSON.parse(receipt.wire).body.raw_response_text!==raw)fail('RECEIPT_CHANGED');
 let writes=0;await databasePersistenceRetry(()=>++writes===1?Promise.reject(Error('MOCK_DATABASE_TIMEOUT')):Promise.resolve(receipt.sha256),()=>Promise.resolve());
 if(writes!==2)fail('DATABASE_RECOVERY_FAILED');replies++;
}
if(replies!==36||state.tasks.filter(t=>t.request_count===1&&t.status==='running').length!==4||state.tasks.filter(t=>t.request_count===0).length!==51)fail('FROZEN_SCOPE_CHANGED');
console.log(JSON.stringify({version:'jls-restaurant-receipt-v1',actual_replies_verified:replies,unknown_attempts_preserved:4,unattempted:51,provider_calls:0,hashes_verified:true}));
