// Explicit, injected supplier mocks. Never opens a transport or writes a run.
import {parallelExecutionContract,compileParallelSol,parallelReadyContract,type ParallelProtocol} from './parallel-report.ts';
import {processRestaurant,type RestaurantState} from './jls-restaurant-worker.ts';
import {snapshotMockPort,snapshotReadyMock} from './jls-snapshot-v2-probe.ts';
import {processReadySol,type ReadyState} from './jls-sol-ready-worker.ts';
import {DIRECT_CATEGORY_KEYS,directHash,parseDirectCategoriesRounded} from './jev-direct-categories.ts';
import {DIRECT_CANDIDATE_EMPTY} from './jev-direct-report-preparation.ts';
import {analysisTextSha256} from './analysis-text.ts';
import {COMPACT_SOL_WIRE} from './parallel-sol-wire.ts';
export function mockParallelResponse(ready:Awaited<ReturnType<typeof compileParallelSol>>){
 const e=ready.body.evidence,manifest=ready.body.compact_wire;
 if(manifest)return {format_version:COMPACT_SOL_WIRE,report:{categories:DIRECT_CATEGORY_KEYS.map(category=>({category,
  text:e.some(e=>e.category===category)?'EXPLICIT TECHNICAL MOCK, NOT A NEW QUALITY EVALUATION.':DIRECT_CANDIDATE_EMPTY,
  refs:manifest.associations.filter(e=>e.category===category).slice(0,1).map(e=>e.ref)})),positive_aspects:[],negative_aspects:[],
  conclusion:{text:'EXPLICIT TECHNICAL MOCK.',refs:[manifest.associations[0].ref]},recommendations:[{title:'EXPLICIT TECHNICAL MOCK CHECK',category:manifest.associations[0].category,
   refs:[manifest.associations[0].ref],observations:[{text:'EXPLICIT TECHNICAL MOCK OBSERVATION',ref:manifest.associations[0].ref}],
   proposed_action:'EXPLICIT TECHNICAL MOCK ACTION',priority_reason:'EXPLICIT TECHNICAL MOCK PRIORITY'}]}};
 return {format_version:'jls-direct-categories4-report-v1',statistics_sha256:ready.body.statistics_sha256,report:{categories:DIRECT_CATEGORY_KEYS.map(category=>({category,
  text:e.some(e=>e.category===category)?'EXPLICIT TECHNICAL MOCK, NOT A NEW QUALITY EVALUATION.':DIRECT_CANDIDATE_EMPTY,
  evidence_ids:e.filter(e=>e.category===category).slice(0,1).map(e=>e.evidence_id)})),positive_aspects:[],negative_aspects:[],
  conclusion:{text:'EXPLICIT TECHNICAL MOCK.',evidence_ids:[e[0].evidence_id]},recommendations:[]}};
}
export async function rehearseParallel(protocol:{id:string;body:ParallelProtocol;sha256:string},saved?:{review_id:string;raw_response_text:string}[]){
 const at=performance.now(),run=crypto.randomUUID();
 const initial={protocol,run:{id:run,stage:'jev',status:'queued'},artifacts:[],tasks:protocol.body.pending.map(p=>({id:crypto.randomUUID(),run_id:run,organization_id:protocol.body.organization_id,
  phase:'jev',review_id:p.review_id,request:p.payload,request_sha256:p.request_sha256,identity:p.identity,status:'pending',request_count:0,worker:'',cache_id:null}))} as unknown as RestaurantState;
 const f=snapshotMockPort(initial);let jev=0,sol=0;
 // The generic mock's legacy finish helper populates a 25-theme cache. Replace
 // that test persistence boundary, not the real shared worker or its parser.
 f.port.finish=(id,_worker,status,body,sha)=>{const t=f.state.tasks.find(t=>t.id===id)!;t.status=status;f.state.artifacts.push({kind:'task:'+id,body:body as Record<string,unknown>,sha256:sha});if(status!=='completed')f.state.run.status='blocked';return Promise.resolve(true);};
 const http:typeof fetch=(url,options)=>{
  if(!String(url).includes('typesafe.ai'))throw Error('MOCK_JEV_ENDPOINT_REQUIRED');jev++;
  const request=JSON.parse(String(options?.body)),id=request.state.review_alias.replace('review_',''),s=saved?.find(s=>s.review_id===id);
  if(saved&&!s)throw Error('SAVED_CLASSIFICATION_MISSING');
  return Promise.resolve(new Response(s?s.raw_response_text:JSON.stringify({model:'jev-1.13.0',usage:{input_tokens:1,output_tokens:1,total_tokens:2},answers:Object.fromEntries(DIRECT_CATEGORY_KEYS.map(k=>[k,{type:'choice',choice:'positive'}]))})));
 };
 for(let i=0;i<Math.ceil(protocol.body.pending.length/8)+2&&f.state.run.stage==='jev';i++)await processRestaurant(f.port,run,{jev:'EXPLICIT_MOCK',openai:''},http,parallelExecutionContract);
 if(f.state.run.stage!=='prepare_evidence'||jev!==protocol.body.pending.length)throw Error('MOCK_JEV_PATH_FAILED');
 const ready=await compileParallelSol(f.state),response=mockParallelResponse(ready);
 const state={protocol,ready,operation:{id:crypto.randomUUID(),organization_id:protocol.body.organization_id,mode:'mock',run_id:run,status:'queued',phase:'sol',request_count:0,worker:null,receipt:null,receipt_sha256:null,result:null}} as unknown as ReadyState;
 const memory=snapshotReadyMock(state),solHttp:typeof fetch=(_url,options)=>{if(options?.body!==ready.body.request_json)throw Error('MOCK_SOL_WIRE_CHANGED');sol++;return Promise.resolve(new Response(JSON.stringify({id:'EXPLICIT_MOCK_NOT_PROVIDER',model:'gpt-6.1-sol',status:'completed',usage:{input_tokens:1,output_tokens:1,total_tokens:2},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(response)}]}]})));};
 await Promise.all(Array.from({length:6},()=>processReadySol(memory.port,memory.state.operation.id,'EXPLICIT_MOCK',solHttp,parallelReadyContract)));
 await processReadySol(memory.port,memory.state.operation.id,'EXPLICIT_MOCK',solHttp,parallelReadyContract);
 await processReadySol(memory.port,memory.state.operation.id,'EXPLICIT_MOCK',solHttp,parallelReadyContract);
 if(sol!==1||memory.state.operation.status!=='completed'||!memory.state.operation.result?.validated_report)throw Error('MOCK_SOL_FINALIZATION_FAILED');
 return {version:protocol.body.version,explicit_technical_mock:true,provider_calls:0,mock_jev:jev,mock_luna:0,mock_sol:sol,status:memory.state.operation.status,
  request_measurement:ready.body.measurement,wall_ms:performance.now()-at,ready,state:f.state,operation:memory.state.operation};
}
// Deployed qualification follows the real durable boundaries. Running 75 mock
// requests plus six concurrent Sol verifications in ONE isolate is not the
// production path and consumes their combined CPU budget needlessly.
export async function boundedParallelFixture(protocol:{id:string;body:ParallelProtocol;sha256:string},saved:{review_id:string;analysis_text_sha256:string;raw_response_text:string}[]){
 const run=crypto.randomUUID(),state={protocol,run:{id:run,stage:'jev',status:'queued'},tasks:[],artifacts:[]} as unknown as RestaurantState;
 for(const pending of protocol.body.pending){const row=saved.find(r=>r.review_id===pending.review_id);if(!row||row.analysis_text_sha256!==pending.identity.analysis_text_sha256)throw Error('PROBE_SOURCE_CHANGED');
  const result=parseDirectCategoriesRounded(JSON.parse(row.raw_response_text)),task={id:crypto.randomUUID(),run_id:run,organization_id:protocol.body.organization_id,phase:'jev' as const,review_id:pending.review_id,request:pending.payload,request_sha256:pending.request_sha256,identity:pending.identity,status:'completed',request_count:1,worker:'EXPLICIT_MOCK',cache_id:null};
  const body={phase:'jev',request_sha256:task.request_sha256,raw_response_text:row.raw_response_text,raw_response_sha256:await analysisTextSha256(row.raw_response_text),direct4_result:result,explicit_technical_mock:true};
  state.tasks.push(task);state.artifacts.push({kind:'task:'+task.id,body,sha256:await directHash(body)});
 }return state;
}
export async function boundedParallelJevProbe(state:RestaurantState,saved:{review_id:string;raw_response_text:string}[]){
 const pending=state.tasks.slice(-Math.min(8,state.tasks.length));for(const t of pending){t.status='pending';t.request_count=0;}state.artifacts=state.artifacts.filter(a=>!pending.some(t=>a.kind==='task:'+t.id));
 const f=snapshotMockPort(state);let calls=0;f.port.finish=(id,_w,status,body,sha)=>{f.state.tasks.find(t=>t.id===id)!.status=status;f.state.artifacts.push({kind:'task:'+id,body:body as Record<string,unknown>,sha256:sha});return Promise.resolve(true);};
 await processRestaurant(f.port,state.run.id,{jev:'EXPLICIT_MOCK',openai:''},(_url,options)=>{calls++;const id=JSON.parse(String(options?.body)).state.review_alias.replace('review_','');return Promise.resolve(new Response(saved.find(r=>r.review_id===id)!.raw_response_text));},parallelExecutionContract);
 if(f.state.run.stage!=='prepare_evidence'||calls!==pending.length)throw Error('BOUNDED_JEV_PROBE_FAILED');return {mock_jev:calls,status:f.state.run.status};
}
export async function boundedParallelSolProbe(protocol:{id:string;body:ParallelProtocol;sha256:string},ready:Awaited<ReturnType<typeof compileParallelSol>>){
 const response=mockParallelResponse(ready);
 const state={protocol,ready,operation:{id:crypto.randomUUID(),organization_id:protocol.body.organization_id,mode:'mock',run_id:ready.body.source_run_id,status:'queued',phase:'sol',request_count:0,worker:null,receipt:null,receipt_sha256:null,result:null}} as unknown as ReadyState;
 const f=snapshotReadyMock(state);let calls=0;const http:typeof fetch=()=>{calls++;return Promise.resolve(new Response(JSON.stringify({id:'EXPLICIT_MOCK_NOT_PROVIDER',model:'gpt-6.1-sol',status:'completed',usage:{input_tokens:1,output_tokens:1,total_tokens:2},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(response)}]}]})));};
 await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',http,parallelReadyContract);await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',http,parallelReadyContract);await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',http,parallelReadyContract);
 if(calls!==1||f.state.operation.status!=='completed')throw Error('BOUNDED_SOL_PROBE_FAILED');return {mock_sol:calls,status:f.state.operation.status,receipt_saved:!!f.state.operation.receipt,result_saved:!!f.state.operation.result};
}
