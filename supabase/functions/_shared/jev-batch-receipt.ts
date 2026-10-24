// Two separate RPC transactions. A continuation failure must never undo an
// acknowledged native receipt or become an instruction to resend a provider.
export async function saveBatchReceipt(
 rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>,
 task:string,worker:string,receipt:unknown,sha:string,
 warn:(code:string)=>void=console.warn,
):Promise<boolean>{
 const saved=await rpc('jev_batch_receive',{p_task:task,p_worker:worker,p_receipt:receipt,p_sha:sha});
 if(saved!==true)return false;
 try{
  const continued=await rpc('jev_batch_continue_received',{p_task:task,p_sha:sha});
  if(continued!==true)warn('BATCH_RECEIPT_SAVED_CONTINUATION_FAILED_CRON_RECOVERY');
 }catch{warn('BATCH_RECEIPT_SAVED_CONTINUATION_FAILED_CRON_RECOVERY');}
 return true;
}
