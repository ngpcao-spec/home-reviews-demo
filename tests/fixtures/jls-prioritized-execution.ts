// Mock-only history, authorization and persistence. Never stored in Supabase.
import { delegatedMockFixture } from "./jev-luna-sol-delegated.ts";
import { mockJlsLuna, mockJlsReport } from "./jev-luna-sol.ts";
import { parseJlsLuna } from "../../supabase/functions/_shared/jev-luna-sol.ts";
import { buildPrioritizedDraft, JLS_PRIORITIZED_VERSION } from "../../supabase/functions/_shared/jev-luna-sol-prioritized.ts";
import { hybridHash } from "../../supabase/functions/_shared/jev-hybrid-evidence.ts";
import { prioritizedExecutionProtocol, prioritizedConsent, type PrioritizedHistory, type PrioritizedPreparation } from "../../supabase/functions/_shared/jls-prioritized-execution.ts";
import type { PrioritizedExecutionPort, PrioritizedExecutionResult, PrioritizedTask } from "../../supabase/functions/_shared/jls-prioritized-worker.ts";
export async function prioritizedExecutionFixture(){
 const f=await delegatedMockFixture(),tasks=[];const org=f.p.organization_id,run_id="explicit_mock_source_run",plan_id="explicit_mock_source_plan";
 for(const g of f.p.luna_groups){const response=mockJlsLuna(g),parsed=await parseJlsLuna(f.p,g,response);tasks.push({id:"mock_history_"+g.review_id,
  organization_id:org,run_id,review_id:g.review_id,phase:"luna",status:"completed",request_count:1,request:g.payload,
  request_sha256:g.request_sha256,response,response_sha256:await hybridHash(response),served_model:"gpt-6-luna",parsed});}
 const decisions=tasks.flatMap(t=>t.parsed.decisions),body={luna_decisions:decisions};
 const history:PrioritizedHistory={run_id,plan_id,organization_id:org,result:{body,result_sha256:await hybridHash(body)},tasks};
 const draft=await buildPrioritizedDraft(f.p,decisions,"vi"),pb={version:JLS_PRIORITIZED_VERSION,language:"vi",organization_id:org,
  source_plan_id:plan_id,source_plan_sha256:await hybridHash(f.p),source_run_id:run_id,source_result_sha256:history.result.result_sha256,execution_authorized:false,draft};
 const preparation:PrioritizedPreparation={id:232,body:pb,sha256:await hybridHash(pb)},protocolBody=await prioritizedExecutionProtocol(preparation,f.p,history),
  protocol={id:"explicit_mock_protocol",body:protocolBody,sha256:await hybridHash(protocolBody)},source={plan:f.p,snapshot:f.snapshot,preparation,protocol,decisions};
 const raw={...mockJlsReport(f.p,draft.accepted_ids),format_version:JLS_PRIORITIZED_VERSION};
 raw.report.axes.forEach(a=>{a.text="Xem bằng chứng cho trục này.";});raw.report.conclusion.text="Xem xét các phản ánh có bằng chứng.";
 const task:PrioritizedTask={id:"explicit_mock_sol_task",run_id:"explicit_mock_new_run",organization_id:org,protocol_id:protocol.id,protocol_sha256:protocol.sha256,
  request:draft.request,request_sha256:draft.request_sha256,status:"queued",request_count:0,lease_owner:null,authorization_expires_at:new Date(Date.now()+24*3600000).toISOString()};
 let consent:Awaited<ReturnType<typeof prioritizedConsent>>|null=null,state="queued",result:PrioritizedExecutionResult|null=null,now=Date.now();
 const port:PrioritizedExecutionPort={
  claim:async(run,worker)=>{
   if(run!==task.run_id||!consent||consent.protocol_sha256!==protocol.sha256||Date.parse(consent.expires_at)<=now||consent.scope.language!=="vi"||consent.scope.max_sol_calls!==1||task.request_count===1||state!=="queued")return null;
   task.request_count=1;task.status="running";task.lease_owner=worker;task.authorization_expires_at=consent.expires_at;state="running";return structuredClone(task);
  },
  finish:async(id,worker,status,body,sha)=>{if(task.id!==id||task.lease_owner!==worker||task.status!=="running"||sha!==await hybridHash(body))return false;
   result=body;state=status;task.status=status;return true;},
  abort:async(_run,error)=>{state=task.request_count===1?"billing_uncertain":"blocked_incompatible";task.status=state;if(result)result.controls.error_code=error;},
 };
 const response=()=>({id:"explicit_mock_sol_response",model:"gpt-6.1-sol",status:"completed",usage:{input_tokens:200,output_tokens:100,total_tokens:300},
  output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(raw)}]}]});
 const http:typeof fetch=async()=>new Response(JSON.stringify(response()),{headers:{"x-request-id":"explicit_mock_request"}});
 return {f,source,history,preparation,protocol,raw,task,port,http,response,now:()=>now,read:()=>({state,result,consent}),
  authorize:async()=>{consent=await prioritizedConsent(protocolBody,protocol.sha256,"EXPLICIT MOCK GO FOR UNIT TESTS ONLY - NOT A REAL USER CONSENT",new Date(now).toISOString());},
  advance:()=>{now+=25*3600000;},setConsent:(c:typeof consent)=>{consent=c;}};
}
