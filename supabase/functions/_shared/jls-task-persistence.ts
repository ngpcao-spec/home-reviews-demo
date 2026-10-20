// Retry database persistence only. Never wrap restaurantAttempt / provider fetch.
import {negativeHash} from './negative-validation-core.ts';
import type {RestaurantState,RestaurantTask} from './jls-restaurant-worker.ts';
export const TASK_RECEIPT_VERSION='jls-restaurant-receipt-v1';
export type RestaurantOutcome={status:string;body:Record<string,unknown>;sha256:string};
export async function taskReceiptWire(state:RestaurantState,task:RestaurantTask,outcome:RestaurantOutcome,source_kind:'provider_outcome'|'existing_artifact'='provider_outcome'){
 const wire=JSON.stringify({version:TASK_RECEIPT_VERSION,source_kind,task_id:task.id,worker:task.worker,
  protocol_sha256:state.protocol.sha256,...outcome});
 return {wire,sha256:await negativeHash(wire)};
}
export async function databasePersistenceRetry<T>(write:()=>Promise<T>,pause:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))):Promise<T>{
 for(let n=0;n<3;n++){
  try{return await write();}catch(e){if(n===2)throw e;await pause(100*(n+1));}
 }
 throw Error('JLS_PERSISTENCE_UNREACHABLE');
}
