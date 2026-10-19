import process from 'node:process';
import {compileCorrectedSol,verifyCorrectedSol,validateCorrectedSol,type CorrectedReport} from '../supabase/functions/_shared/jls-corrected80-preparation.ts';
import {parseJlsLuna,acceptedJlsEvidence,type JlsDecision} from '../supabase/functions/_shared/jev-luna-sol.ts';
import {processReadySol,type ReadyState,type ReadyContract} from '../supabase/functions/_shared/jls-sol-ready-worker.ts';
import {snapshotReadyMock} from '../supabase/functions/_shared/jls-snapshot-v2-probe.ts';
import {hybridHash} from '../supabase/functions/_shared/jev-hybrid-evidence.ts';
globalThis.fetch=()=>{throw Error('ALL_PROVIDER_NETWORK_FORBIDDEN');};
const [inputPath,preparedPath,outputPath]=Deno.args,input=JSON.parse(await Deno.readTextFile(inputPath)),p:CorrectedReport=JSON.parse(await Deno.readTextFile(preparedPath));
if(await hybridHash(p.body)!==p.sha256)throw Error('PREPARATION_CHANGED');
const results=[];
for(const assumption of ['supported','unsupported','uncertain'] as const){
 const ds:JlsDecision[]=[...p.body.reused_decisions];
 for(const g of p.body.pending_groups){const raw={model:'gpt-6-luna',usage:{input_tokens:1,output_tokens:0,total_tokens:1},
  answers:g.evidence_ids.map(name=>({type:'choice',name,choice:assumption,confidence:1,probabilities:['supported','unsupported','uncertain'].map(value=>({value,probability:value===assumption?1:0}))}))};
  ds.push(...(await parseJlsLuna(p.body.plan,g,raw)).decisions);
 }
 const timings=[];let cpu=process.cpuUsage(),at=performance.now();
 const ready=await compileCorrectedSol(p,ds);timings.push({phase:'free_compile',cpu_ms:Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b)/1000,wall_ms:performance.now()-at});
 if(!ready.artifact)throw Error('MOCK_GATE_FAILED_'+assumption);
 const a=ready.artifact;
 const state={protocol:{id:'EXPLICIT_MOCK',sha256:p.sha256,body:{snapshot:input.snapshot,sol_size_policy:p.body.plan.sol_size_policy}},
  ready:{body:{...a.body,plan:p.body.plan,sol:{gate:a.body.gate,draft:a.body.draft}},sha256:a.sha256},
  operation:{id:'EXPLICIT_MOCK_NOT_A_RUN',organization_id:p.body.organization_id,mode:'mock',run_id:null,phase:'sol',status:'queued',request_count:0,worker:null,receipt:null,receipt_sha256:null,result:null}} as unknown as ReadyState;
 const f=snapshotReadyMock(state),contract:ReadyContract={verify:()=>verifyCorrectedSol(p,a),validate:raw=>validateCorrectedSol(raw,p,input.snapshot,a)};
 for(const phase of ['dispatch','validate_save']){cpu=process.cpuUsage();at=performance.now();
  const outcome=await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',f.http,contract);
  timings.push({phase,cpu_ms:Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b)/1000,wall_ms:performance.now()-at});
  if(outcome.error_code)throw Error(JSON.stringify(outcome));
 }
 if(!f.state.operation.result?.validated_report||f.calls.length!==1||f.state.operation.status==='invalid_output')throw Error('MOCK_SAVE_FAILED_'+JSON.stringify(f.state.operation.result));
 await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',f.http,contract);
 if(f.calls.length!==1)throw Error('MOCK_RETRY');
 const saved=f.state.operation.result.validated_report as {report:{recommendations:unknown[]}};
 if(saved.report.recommendations.length)throw Error('MOCK_MUST_NOT_INVENT_RECOMMENDATIONS');
 results.push({assumption,explicit_technical_mock:true,not_predictions:true,provider_calls:0,gate:ready.gate,
  accepted:acceptedJlsEvidence(p.body.plan,ds).length,request_size:a.body.measurement,stages:timings,
  raw_receipt_saved:!!f.state.operation.receipt,validation_saved:true,saved_result_sha256:await hybridHash(f.state.operation.result)});
}
const body={version:'jls-corrected80-offline-qualification-v1',preparation_sha256:p.sha256,provider_network_denied:true,provider_calls:0,
 paid_consent_created:false,paid_run_created:false,results,memory:Deno.memoryUsage(),runtime:Deno.version};
await Deno.writeTextFile(outputPath,JSON.stringify({body,sha256:await hybridHash(body)}));
console.log(JSON.stringify(body));
