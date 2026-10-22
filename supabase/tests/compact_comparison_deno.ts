import {compactComparisonFixture} from '../../tests/fixtures/compact-sol-comparison.ts';
import {verifyCompactComparison,compactComparisonMock} from '../functions/_shared/compact-sol-comparison.ts';
import {candidateExecutionContract} from '../functions/_shared/jls-direct4-candidates-server.ts';
import {snapshotReadyMock} from '../functions/_shared/jls-snapshot-v2-probe.ts';
import {processReadySol,type ReadyState} from '../functions/_shared/jls-sol-ready-worker.ts';
import {directHash} from '../functions/_shared/jev-direct-categories.ts';
Deno.test('compact comparison uses shared one-attempt Sol receipt/validation path without network',async()=>{
 const saved=globalThis.fetch;globalThis.fetch=()=>{throw Error('PROVIDER_NETWORK_FORBIDDEN');};
 try{const {protocol:p}=await compactComparisonFixture();await verifyCompactComparison(p.body,p.sha256);const a=p.body.ready_template,pid=crypto.randomUUID(),run=crypto.randomUUID();
 const b={version:'jls-direct4-sol-ready-v1',source_protocol_id:pid,source_protocol_sha256:p.sha256,source_run_id:run,candidate_template:a,request_json:a.request_json,request_sha256:a.request_sha256,request_raw_sha256:a.request_raw_sha256};
 const f=snapshotReadyMock({protocol:{id:pid,...p},ready:{body:b,sha256:await directHash(b)},operation:{id:crypto.randomUUID(),organization_id:p.body.organization_id,mode:'mock',run_id:run,status:'queued',phase:'sol',request_count:0,worker:null,receipt:null,receipt_sha256:null,result:null}} as unknown as ReadyState);
 let calls=0;const http:typeof fetch=()=>{calls++;return Promise.resolve(new Response(JSON.stringify(compactComparisonMock(p.body))));};
 await Promise.all(Array.from({length:4},()=>processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',http,candidateExecutionContract)));
 await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',http,candidateExecutionContract);await processReadySol(f.port,f.state.operation.id,'EXPLICIT_MOCK',http,candidateExecutionContract);
 if(calls!==1||f.state.operation.status!=='completed'||!f.state.operation.result?.validated_report)throw Error('SHARED_PATH_FAILED');
 }finally{globalThis.fetch=saved;}
});
