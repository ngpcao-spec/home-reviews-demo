// Thin route adapter: reservations, receipts and persistence remain Sol-ready's.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {candidateReadyContract,candidateMockResponse,DIRECT4_CANDIDATES,type CandidateProtocol} from './jls-direct4-candidates.ts';
import {solReadyPort} from './jls-sol-ready-store.ts';
import {processReadySol} from './jls-sol-ready-worker.ts';
import {directHash} from './jev-direct-categories.ts';
import {COMPACT_SOL_WIRE} from './parallel-sol-wire.ts';
import {compactComparisonContract,compactComparisonMock,type CompactComparison} from './compact-sol-comparison.ts';
import type {ReadyContract,ReadyState} from './jls-sol-ready-worker.ts';
const isCompact=(s:ReadyState)=>(s.protocol.body as unknown as {configuration:{sol_wire_version?:string}}).configuration.sol_wire_version===COMPACT_SOL_WIRE;
export const candidateExecutionContract:ReadyContract={verify:s=>(isCompact(s)?compactComparisonContract:candidateReadyContract).verify(s),
 validate:(raw,s,plan)=>(isCompact(s)?compactComparisonContract:candidateReadyContract).validate(raw,s,plan),
 reportItems:value=>(value as {response_format_version?:string}).response_format_version===COMPACT_SOL_WIRE?compactComparisonContract.reportItems!(value):[]};
export async function probeCandidateOperation(admin:SupabaseClient,id:string){
 const port=solReadyPort(admin),s=await port.load(id);
 if(s.operation.mode!=='mock'||s.protocol.body.version!==DIRECT4_CANDIDATES||!s.operation.run_id)throw Error('DIRECT_CANDIDATES_MOCK_REQUIRED');
 const q=await admin.from('analysis_jls_sql_qualifications').select('id').eq('run_id',s.operation.run_id).eq('protocol_id',s.protocol.id).single();
 if(q.error)throw Error('DIRECT_CANDIDATES_MOCK_REQUIRED');
 const at=performance.now();let calls=0;
 const http:typeof fetch=async(url,options)=>{
  if(String(url)!=='https://api.openai.com/v1/responses'||options?.body!==s.ready.body.request_json)throw Error('DIRECT_CANDIDATES_MOCK_WIRE_CHANGED');
  calls++;return new Response(JSON.stringify(isCompact(s)?compactComparisonMock(s.protocol.body as unknown as CompactComparison['body']):candidateMockResponse(s.protocol.body as unknown as CandidateProtocol['body'])));
 };
 const result=await processReadySol(port,id,'EXPLICIT_MOCK_NO_PROVIDER',http,candidateExecutionContract),after=await port.load(id);
 const body={version:DIRECT4_CANDIDATES,protocol_sha256:s.protocol.sha256,operation_id:id,explicit_technical_mock:true,provider_calls:0,
  mock_calls:calls,phase:s.operation.phase,result,status:after.operation.status,raw_receipt_saved:!!after.operation.receipt,
  validated_report_saved:!!after.operation.result?.validated_report,wall_ms:performance.now()-at,memory:Deno.memoryUsage(),execution_id:Deno.env.get('SB_EXECUTION_ID')??null};
 if(['concurrent_or_consumed','already_recorded'].includes(result.phase))return body;
 const saved=await admin.rpc('save_jls_snapshot_preparation',{p_protocol:s.protocol.id,p_kind:'candidate_deployed_probe_'+s.operation.phase,p_body:body,p_sha:await directHash(body)});
 if(saved.error)throw Error('DIRECT_CANDIDATES_PROBE_SAVE_FAILED');return {archive_id:saved.data,...body};
}
