import {it,expect,vi,beforeAll,afterAll} from 'vitest';
import {readFileSync} from 'node:fs';
import {directHash,DIRECT_CATEGORY_KEYS} from '../../supabase/functions/_shared/jev-direct-categories';
import {directReportLunaGroups,type DirectReportEvidence,type DirectReportPreparation} from '../../supabase/functions/_shared/jev-direct-report-preparation';
import {direct4RestaurantContract,direct4ReadyContract,direct4Consent,verifyDirect4Preparation,DIRECT4_PREPARATION_ID,DIRECT4_PREPARATION_SHA,DIRECT4_PROTOCOL_VERSION,type Direct4Protocol} from '../../supabase/functions/_shared/jls-direct4-execution';
import {SOL_SIZE_POLICY} from '../../supabase/functions/_shared/jls-sol-size';
import {direct4MockState} from '../../supabase/functions/_shared/jls-direct4-probe';
import {snapshotMockPort} from '../../supabase/functions/_shared/jls-snapshot-v2-probe';
import {processRestaurant} from '../../supabase/functions/_shared/jls-restaurant-worker';
import {processReadySol,type ReadyContract} from '../../supabase/functions/_shared/jls-sol-ready-worker';
import {readyFixture} from '../fixtures/jls-sol-ready';
import {direct4ReadView} from '../../supabase/functions/_shared/jls-direct4-server';
let network:ReturnType<typeof vi.spyOn>;
beforeAll(()=>{network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('PROVIDER_NETWORK_FORBIDDEN'));});
afterAll(()=>{expect(network).not.toHaveBeenCalled();network.mockRestore();});
it('prepares an exactly scoped delegated consent in memory only, and refuses a different preparation',async()=>{
 const configuration={policy:{automatic_retry:false,provider_client_retries:0}},body={version:DIRECT4_PROTOCOL_VERSION,
  preparation_id:DIRECT4_PREPARATION_ID,preparation_sha256:DIRECT4_PREPARATION_SHA,max_jev_calls:0,max_luna_calls:32,max_sol_calls:1,
  pending:[],language:'vi',production_enabled:false,configuration,configuration_sha256:await directHash(configuration),sol_size_policy:SOL_SIZE_POLICY,
  establishment_id:'synthetic_est',organization_id:'synthetic_org'} as unknown as Direct4Protocol['body'];
 const sha=await directHash(body),go='GO — one execution of preparation '+DIRECT4_PREPARATION_ID;
 const consent=await direct4Consent(body,sha,go,'2026-10-19T00:00:00.000Z');
 expect(consent.preparation_id).toBe(DIRECT4_PREPARATION_ID);expect(consent.protocol_sha256).toBe(sha);
 expect(consent.scope.max_luna_calls).toBe(32);expect(consent.scope.max_jev_calls).toBe(0);
 expect(consent.expires_at).toBe('2026-10-20T00:00:00.000Z');
 await expect(direct4Consent(body,sha,'GO for another source','2026-10-19T00:00:00Z')).rejects.toThrow('DIRECT4_GO_SCOPE_CHANGED');
 await expect(direct4Consent(body,'changed',go,'2026-10-19T00:00:00Z')).rejects.toThrow('DIRECT4_PROTOCOL_CHANGED');
});
async function lunaFixture(){
 const es=await Promise.all(Array.from({length:32},async(_,n)=>({evidence_id:'synthetic_'+n,review_id:'synthetic_review_'+n,
  category:DIRECT_CATEGORY_KEYS[n%4],polarity:n<8?'negative':'positive',quote:'EXPLICIT SYNTHETIC '+n,context:'EXPLICIT SYNTHETIC '+n,
  analysis_text_sha256:await directHash('synthetic_'+n),quote_sha256:await directHash('synthetic_'+n)} as DirectReportEvidence)));
 const groups=await directReportLunaGroups(es),p={body:{luna_groups:groups,organization_id:'synthetic_org',source_snapshot:{sha256:'synthetic'}}} as unknown as DirectReportPreparation;
 const protocol={id:'synthetic_protocol',sha256:'synthetic',body:{organization_id:'synthetic_org',version:DIRECT4_PROTOCOL_VERSION,max_jev_calls:0}} as unknown as Parameters<typeof direct4MockState>[1];
 const f=snapshotMockPort(await direct4MockState(p,protocol)),contract=direct4RestaurantContract(p);
 // Mock only the source-verification boundary for synthetic queue tests. The real
 // sealed source and this exact contract are exercised by the Deno + deployed probes.
 contract.verify=async()=>{};f.port.cache=async()=>{throw Error('MUST_NOT_LOAD_25_THEME_CACHE');};
 return {...f,contract};
}
it('reuses the queue, groups and parser for exactly 32 mock Luna attempts and no JEV/cache access',async()=>{
 const f=await lunaFixture();for(let n=0;n<4;n++)await processRestaurant(f.port,f.state.run.id,{jev:'',openai:'mock'},f.http,f.contract);
 expect(f.calls).toHaveLength(32);expect(f.calls.every(u=>u.endsWith('/v1/decisions'))).toBe(true);
 expect(f.state.run.stage).toBe('prepare_sol');expect(f.state.tasks.every(t=>t.request_count===1&&t.status==='completed')).toBe(true);
 const saved=f.state.artifacts.find(a=>a.kind==='luna_decisions')!;expect(saved.body.results).toHaveLength(32);
});
it('concurrent and repeated Luna wakes cannot duplicate a reserved task',async()=>{
 const f=await lunaFixture();await Promise.all(Array.from({length:8},()=>processRestaurant(f.port,f.state.run.id,{jev:'',openai:'mock'},f.http,f.contract)));
 expect(f.calls).toHaveLength(8);for(let n=0;n<3;n++)await processRestaurant(f.port,f.state.run.id,{jev:'',openai:'mock'},f.http,f.contract);
 expect(f.calls).toHaveLength(32);expect(f.state.tasks.every(t=>t.request_count===1)).toBe(true);
});
it('no authorization means no reservation or call',async()=>{
 const f=await lunaFixture();f.deny();await processRestaurant(f.port,f.state.run.id,{jev:'',openai:'mock'},f.http,f.contract);
 expect(f.calls).toHaveLength(0);expect(f.state.tasks.every(t=>t.request_count===0)).toBe(true);
});
it.each(['timeout','lost_response','429','500','invalid_json','wrong_model'] as const)('Luna %s is retained and never retried',async kind=>{
 const f=await lunaFixture();let calls=0;
 const http:typeof fetch=async()=>{calls++;if(['timeout','lost_response'].includes(kind))throw Error('EXPLICIT_MOCK_LOSS');
  if(kind==='invalid_json')return new Response('EXPLICIT_MOCK_INVALID_JSON');
  return new Response(JSON.stringify({model:'WRONG_MODEL',usage:{input_tokens:1,output_tokens:0,total_tokens:1},answers:[]}),{status:kind==='429'?429:kind==='500'?500:200});};
 await processRestaurant(f.port,f.state.run.id,{jev:'',openai:'mock'},http,f.contract);
 const consumed=calls;expect(consumed).toBe(8);expect(f.state.run.status).toBe('blocked');
 await processRestaurant(f.port,f.state.run.id,{jev:'',openai:'mock'},http,f.contract);
 expect(calls).toBe(consumed);expect(f.state.tasks.filter(t=>t.request_count===1)).toHaveLength(8);
 expect(f.state.artifacts.filter(a=>a.kind.startsWith('task:'))).toHaveLength(8);
});
it('altered sealed preparations fail without a supplier probe',async()=>{
 await expect(verifyDirect4Preparation({sha256:'0'.repeat(64),body:{}} as DirectReportPreparation)).rejects.toThrow('PREPARATION_CHANGED');
});
async function solFixture(){
 const f=await readyFixture(),report={validator_version:'EXPLICIT_SYNTHETIC_FOUR_CATEGORY',report:{
  categories:DIRECT_CATEGORY_KEYS.map(category=>({category,text:'EXPLICIT SYNTHETIC',evidence_ids:[]})),positive_aspects:[],negative_aspects:[],
  conclusion:{text:'EXPLICIT SYNTHETIC',evidence_ids:[]},recommendations:[]}};
 const contract:ReadyContract={verify:async()=>f.state.ready.body.plan,
  validate:async()=>report as unknown as Awaited<ReturnType<ReadyContract['validate']>>,reportItems:direct4ReadyContract.reportItems};
 let calls=0;const http:typeof fetch=async()=>{calls++;expect(f.state.operation.request_count).toBe(1);
  return new Response(JSON.stringify({model:'gpt-6.1-sol',status:'completed',usage:{input_tokens:1,output_tokens:1,total_tokens:2},
   output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(report)}]}]}));};
 return {...f,contract,http,count:()=>calls};
}
it('Sol stores raw first, finalizes report.categories in a separate wake and exposes the saved result',async()=>{
 const f=await solFixture();await processReadySol(f.port,f.state.operation.id,'mock',f.http,f.contract);
 expect(f.state.operation.result).toBeNull();expect(f.state.operation.receipt?.raw_response_text).toBeTruthy();
 await processReadySol(f.port,f.state.operation.id,'mock',f.http,f.contract);expect(f.state.operation.status).toBe('completed');
 expect(f.state.operation.result?.validated_report).toHaveProperty('report.categories');
 const view=direct4ReadView({id:'mock',body:{version:DIRECT4_PROTOCOL_VERSION},sha256:'mock'},null,[],[],f.state.operation);
 expect(view.sol_operation).toHaveProperty('result.validated_report.report.categories');expect(view.new_provider_calls).toBe(0);
 await processReadySol(f.port,f.state.operation.id,'mock',f.http,f.contract);expect(f.count()).toBe(1);
},15000);
it('repeated/concurrent Sol wakeups send at most one request',async()=>{
 const f=await solFixture();await Promise.all(Array.from({length:8},()=>processReadySol(f.port,f.state.operation.id,'mock',f.http,f.contract)));
 for(let n=0;n<3;n++)await processReadySol(f.port,f.state.operation.id,'mock',f.http,f.contract);expect(f.count()).toBe(1);
});
it.each(['timeout','receipt_save_loss','validator_error','permission'] as const)('Sol %s preserves the consumed attempt without retry',async kind=>{
 const f=await solFixture();let calls=0;const http:typeof fetch=async(...args)=>{calls++;if(kind==='timeout')throw Error('EXPLICIT_MOCK_TIMEOUT');return f.http(...args);};
 if(kind==='permission')f.deny();if(kind==='receipt_save_loss')f.port.receive=async()=>false;
 if(kind==='validator_error')f.contract.validate=async()=>{throw Error('EXPLICIT_MOCK_INVALID_OUTPUT');};
 await processReadySol(f.port,f.state.operation.id,'mock',http,f.contract);
 await processReadySol(f.port,f.state.operation.id,'mock',http,f.contract);
 await processReadySol(f.port,f.state.operation.id,'mock',http,f.contract);
 expect(calls).toBe(kind==='permission'?0:1);
 if(kind==='validator_error'){expect(f.state.operation.receipt).not.toBeNull();expect(f.state.operation.status).toBe('invalid_output');}
});
it('wiring is opt-in, probes exit before secrets and migrations create no paid data or automatic dispatch',()=>{
 const sql=readFileSync('supabase/migrations/20261019110133_jls_direct4_worker_adapter.sql','utf8');
 expect(sql).toContain('authorize_jls_restaurant_pre_ready');expect(sql).toContain('DIRECT4_DEPLOYED_QUALIFICATION_REQUIRED');
 expect(sql).toContain('revoke all on function');expect(sql).not.toMatch(/^\s*(?:select|perform) public\.(?:authorize|wake)_/mi);
 const server=readFileSync('supabase/functions/process-jls-restaurant/index.ts','utf8');
 expect(server.indexOf("mode==='direct4_probe'")).toBeLessThan(server.indexOf('Deno.env.get("OPENAI_API_KEY")'));
 const read=readFileSync('supabase/functions/jls-restaurant/index.ts','utf8');expect(read).toContain(".neq('body->>version',DIRECT4_PROTOCOL_VERSION)");
 expect(read).not.toContain('authorize_jls_restaurant');
});
