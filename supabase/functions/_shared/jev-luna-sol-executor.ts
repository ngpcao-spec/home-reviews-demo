import { type JlsPlan, parseJlsLuna } from "./jev-luna-sol.ts";
import { type JlsExecutionTask, prepareAcceptedSol, executionCosts } from "./jev-luna-sol-delegation.ts";
import { hybridHash } from "./jev-hybrid-evidence.ts";
import { validateJlsReport } from "./jev-luna-sol-validation.ts";
import { redactDecisionSecrets } from "./decisions-evidence40-worker.ts";
import type { PilotSnapshot } from "./jev-pilot-core.ts";
export interface JlsExecutionPort {
  claim(run:string,phase:"luna"|"sol",worker:string):Promise<JlsExecutionTask|null>;
  finish(task:string,worker:string,status:string,output:Record<string,unknown>):Promise<void>;
  tasks(run:string):Promise<JlsExecutionTask[]>;
  stop(run:string,status:string,error:string):Promise<void>;
  freezeSol(run:string,dossier:NonNullable<Awaited<ReturnType<typeof prepareAcceptedSol>>["dossier"]>):Promise<boolean>;
  complete(run:string,result:unknown,sha:string,status:string):Promise<void>;
}
// Called ONLY for a persisted, independently authenticated, explicitly authorized run.
// Each claim is a transaction committed before HTTP; no SDK retry or alternate endpoint.
export async function processDelegatedJls(port:JlsExecutionPort,p:JlsPlan,snapshot:PilotSnapshot,run:string,key:string,http:typeof fetch) {
  if(!key.trim()){await port.stop(run,"failed","OPENAI_API_KEY_UNAVAILABLE");return;}
  let lunaSent=0;
  const send=async(task:JlsExecutionTask,worker:string)=>{
    const output:Record<string,unknown>={},start=Date.now();let status="billing_uncertain", dispatched=false;
    try{
      if(task.run_id!==run||task.organization_id!==p.organization_id||task.request_count!==1||task.status!=="running"||task.lease_owner!==worker||await hybridHash(task.request)!==task.request_sha256)
        throw new Error("JLS_RESERVED_TASK_CHANGED");
      if(task.phase==="luna"){
        const group=p.luna_groups.find(g=>g.review_id===task.review_id);
        if(!group||group.request_sha256!==task.request_sha256)throw new Error("JLS_RESERVED_TASK_CHANGED");
      }
      dispatched=true;
      if(task.phase==="luna")lunaSent++;
      const response=await http("https://api.openai.com"+(task.phase==="luna"?"/v1/decisions":"/v1/responses"),{
        method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify(task.request),
        redirect:"error",signal:AbortSignal.timeout(task.phase==="luna"?25000:110000)});
      const raw=redactDecisionSecrets(await response.json(),key) as Record<string,unknown>;
      output.response=raw;output.response_sha256=await hybridHash(raw);output.provider_request_id=response.headers.get("x-request-id");
      output.response_id=typeof raw.id==="string"?raw.id:null;output.served_model=typeof raw.model==="string"?raw.model:null;
      const usage=raw.usage as Record<string,unknown>|undefined,model=task.phase==="luna"?"gpt-6-luna":"gpt-6.1-sol";
      if(usage&&Number.isSafeInteger(usage.input_tokens)&&Number(usage.input_tokens)>0&&Number.isSafeInteger(usage.output_tokens)&&Number(usage.output_tokens)>=0&&usage.total_tokens===Number(usage.input_tokens)+Number(usage.output_tokens)){
        output.input_tokens=usage.input_tokens;output.output_tokens=usage.output_tokens;output.usage_details=usage;
        const rates=p.estimates.sol.rates;
        output.cost_usd=raw.model!==model?null:task.phase==="luna"?Number(usage.input_tokens)*p.estimates.luna_rate_per_million/1e6:
          rates.sol_input===null||rates.sol_output===null?null:(Number(usage.input_tokens)*rates.sol_input+Number(usage.output_tokens)*rates.sol_output)/1e6;
      }
      if(!response.ok){status=[401,403,404].includes(response.status)?"failed":"billing_uncertain";throw new Error("JLS_PROVIDER_HTTP_"+response.status);}
      if(raw.model!==model){status="invalid_output";throw new Error("JLS_SERVED_MODEL_CHANGED");}
      if(output.input_tokens===undefined)throw new Error("JLS_USAGE_MISSING_BILLING_UNCERTAIN");
      status="invalid_output";
      if(task.phase==="luna")output.parsed=await parseJlsLuna(p,p.luna_groups.find(g=>g.review_id===task.review_id)!,raw);
      else{
        if(raw.status!=="completed"||!Array.isArray(raw.output))throw new Error("JLS_SOL_INCOMPLETE");
        const messages=raw.output.filter((v:unknown)=>!!v&&typeof v==="object"&&(v as {type:string}).type==="message") as {content:{type:string;text?:string}[]}[];
        const texts=messages.flatMap(m=>m.content.filter(c=>c.type==="output_text").map(c=>c.text??""));
        if(messages.some(m=>m.content.some(c=>c.type==="refusal"))||texts.length!==1)throw new Error("JLS_SOL_REFUSED_OR_INVALID");
        const prepared=await prepareAcceptedSol(p,await port.tasks(run));
        if(!prepared.gate.passed||!prepared.dossier||await hybridHash(prepared.dossier.request)!==task.request_sha256)throw new Error("JLS_SOL_DOSSIER_CHANGED");
        output.parsed=await validateJlsReport(JSON.parse(texts[0]),p,snapshot,prepared.decisions);
      }
      status="completed";
    }catch(e){if(!dispatched)status="failed";output.error_code=e instanceof Error&&/^[A-Z_0-9]+$/.test(e.message)?e.message:"JLS_NETWORK_OR_PARSING_BILLING_UNCERTAIN";}
    output.duration_ms=Date.now()-start;
    try{await port.finish(task.id,worker,status,output);}catch{
      await port.stop(run,"billing_uncertain","JLS_RESULT_SAVE_UNCERTAIN_NO_RETRY");throw new Error("JLS_RESULT_SAVE_UNCERTAIN_NO_RETRY");
    } // Failure to save NEVER authorizes another HTTP attempt.
    if(status!=="completed")await port.stop(run,status==="billing_uncertain"?"billing_uncertain":"failed",String(output.error_code));
  };
  for(let batch=0;batch<2;batch++)await Promise.all(Array.from({length:4},async()=>{
    const worker=crypto.randomUUID(),t=await port.claim(run,"luna",worker);if(t)await send(t,worker);
  }));
  let tasks=await port.tasks(run);if(tasks.some(t=>t.phase==="luna"&&(t.status==="queued"||t.status==="running")||t.phase==="sol"&&t.status==="running"))return;
  const prepared=await prepareAcceptedSol(p,tasks);
  if(!prepared.gate.passed||!prepared.dossier){await port.stop(run,"insufficient_evidence","JLS_EVIDENCE_GATE_FAILED");return;}
  if(!await port.freezeSol(run,prepared.dossier))return;
  // Separate durable wake for Sol avoids accumulating Luna timeouts plus a long
  // report response inside one Edge invocation's wall-clock budget.
  if(lunaSent>0)return;
  const worker=crypto.randomUUID(),sol=await port.claim(run,"sol",worker);if(sol)await send(sol,worker);
  tasks=await port.tasks(run);const t=tasks.find(t=>t.phase==="sol");if(!t||t.status!=="completed")return;
  const parsed=t.parsed as unknown as Awaited<ReturnType<typeof validateJlsReport>>;
  const report=parsed.report,items=[...report.axes,...report.positive_aspects,...report.negative_aspects,report.conclusion,...report.recommendations];
  const result={version:"jls-delegated-pilot-result-v1",plan_sha256:await hybridHash(p),statistics:p.statistics,
    gate:prepared.gate,luna_decisions:prepared.decisions,sol_dossier:prepared.dossier,sol_result:parsed,costs:executionCosts(tasks),
    human_validated:false,production_enabled:false};
  await port.complete(run,result,await hybridHash(result),items.some(i=>i.status==="review_needed")?"needs_review":"completed");
}
