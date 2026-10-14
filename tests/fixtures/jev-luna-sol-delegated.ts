// Explicit synthetic execution fixture, never saved to Supabase or used as reference labels.
import {jlsFixture,mockJlsReport} from "./jev-luna-sol";
import {hybridHash} from "../../supabase/functions/_shared/jev-hybrid-evidence";
import {evidencePayload} from "../../supabase/functions/_shared/decisions-config";
import type {JlsExecutionTask} from "../../supabase/functions/_shared/jev-luna-sol-delegation";
import type {JlsExecutionPort} from "../../supabase/functions/_shared/jev-luna-sol-executor";
export async function delegatedMockFixture(){
 const f=await jlsFixture(),p=structuredClone(f.jls),snapshot=structuredClone(f.snapshot);
 p.selected=[];p.luna_groups=[];snapshot.source.reviews=[];
 const multi=f.jls.luna_groups.find(g=>g.evidence_ids.length===2)!;
 for(let i=0;i<24;i++){
  const axis=["quality","service","price","atmosphere"][i%4],
   base=i===0?f.jls.selected.find(e=>e.evidence_id===multi.evidence_ids[0])!:f.jls.selected.find(e=>e.axis===axis&&e.polarity==="negative")??f.jls.selected.find(e=>e.axis===axis)!;
  const origin=f.snapshot.source.reviews.find(r=>r.id===base.review_id)!,review_id=`11111111-1111-4111-8111-${String(i+1).padStart(12,"0")}`;
  const es=[base,...i===0?[f.jls.selected.find(e=>e.evidence_id===multi.evidence_ids[1])!]:[]].map((e,j)=>({...e,review_id,evidence_id:`explicit_mock_${i}_${j}`,rating:i<8?2:5}));
  snapshot.source.reviews.push({...origin,id:review_id,rating:i<8?2:5});p.selected.push(...es);
  const payload=evidencePayload("mock_"+i,origin.analysis_text!,base.theme_key,base.polarity);
  payload.questions=es.map(e=>({...evidencePayload("unused","unused",e.theme_key,e.polarity).questions[0],name:e.evidence_id}));
  p.luna_groups.push({review_id,evidence_ids:es.map(e=>e.evidence_id),analysis_text_sha256:origin.analysis_text_sha256!,payload,
   request_sha256:await hybridHash(payload),questions_sha256:await hybridHash(payload.questions),estimated_input_tokens:100});
 }
 p.question_count=25;p.max_luna_calls=24;
 let state="running",completed:unknown=null,solDossier:unknown=null;
 const tasks:JlsExecutionTask[]=p.luna_groups.map((g,i)=>({id:"task_"+i,run_id:"explicit_mock_run",organization_id:p.organization_id,phase:"luna",review_id:g.review_id,
  request:g.payload,request_sha256:g.request_sha256,status:"queued",request_count:0,lease_owner:null,parsed:null,input_tokens:null,output_tokens:null,cost_usd:null,duration_ms:null,served_model:null,error_code:null}));
 const port:JlsExecutionPort={
  claim:(_run,phase,worker)=>{const t=state!=="running"?undefined:tasks.find(t=>t.phase===phase&&t.status==="queued");if(!t)return Promise.resolve(null);t.status="running";t.request_count=1;t.lease_owner=worker;return Promise.resolve(structuredClone(t));},
  finish:(id,worker,status,out)=>{const t=tasks.find(t=>t.id===id)!;if(t.lease_owner!==worker||t.status!=="running")return Promise.reject(new Error("MOCK_RESERVATION_INVALID"));Object.assign(t,out,{status});return Promise.resolve();},
  tasks:()=>Promise.resolve(tasks),stop:(_r,status,error)=>{if(state==="running")state=status;for(const t of tasks)if(t.status==="queued"){t.status="cancelled";t.error_code=error;}return Promise.resolve();},
  freezeSol:async(_run,dossier)=>{if(state!=="running")return false;solDossier=dossier;if(!tasks.some(t=>t.phase==="sol"))tasks.push({id:"sol",run_id:"explicit_mock_run",organization_id:p.organization_id,phase:"sol",review_id:null,request:dossier.request,request_sha256:await hybridHash(dossier.request),status:"queued",request_count:0,lease_owner:null,parsed:null,input_tokens:null,output_tokens:null,cost_usd:null,duration_ms:null,served_model:null,error_code:null});return true;},
  complete:(_r,result,_sha,status)=>{completed=result;state=status;return Promise.resolve();},
 };
 const http:typeof fetch=(_url,init)=>{
  const request=JSON.parse(String(init!.body));
  if(request.model==="gpt-6-luna")return Promise.resolve(new Response(JSON.stringify({model:"gpt-6-luna",usage:{input_tokens:100,output_tokens:0,total_tokens:100},answers:request.questions.map((q:{name:string})=>({name:q.name,type:"choice",choice:"supported",confidence:.9,probabilities:[{value:"supported",probability:.96},{value:"unsupported",probability:.02},{value:"uncertain",probability:.02}]}))})));
  return Promise.resolve(new Response(JSON.stringify({id:"explicit_mock_sol",model:"gpt-6.1-sol",status:"completed",usage:{input_tokens:200,output_tokens:100,total_tokens:300},output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(mockJlsReport(p,p.selected.map(e=>e.evidence_id)))}]}]})));
 };
 return {p,snapshot,tasks,port,http,read:()=>({state,completed,solDossier})};
}
