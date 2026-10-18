// Explicit technical mocks on the real frozen dossier. No database writes or network.
import {prepareChill80,type Chill80Input} from '../supabase/functions/_shared/jev-chill-reanalysis80.ts';
import {processChill80,type Chill80Port} from '../supabase/functions/_shared/jev-chill80-worker.ts';
import type {Target9Record} from '../supabase/functions/_shared/jev-targeted9-worker.ts';
import {THEME_KEYS} from '../supabase/functions/_shared/jev-themes.ts';
import {hybridHash} from '../supabase/functions/_shared/jev-hybrid-evidence.ts';
import {negativeHash} from '../supabase/functions/_shared/negative-validation-core.ts';
globalThis.fetch=()=>{throw Error('PROVIDER_NETWORK_FORBIDDEN');};
const input=JSON.parse(await Deno.readTextFile(Deno.args[0])) as Chill80Input,protocol=await prepareChill80(input);
const id='EXPLICIT_LOCAL_MOCK_NOT_A_REAL_RUN',pid='EXPLICIT_LOCAL_MOCK_NOT_A_REAL_PROTOCOL',directive='SYNTHETIC LOCAL MEMORY ONLY. NOT USER CONSENT.';
const body={full_protocol_id:pid,protocol_sha256:protocol.sha256,pending_sha256:protocol.body.pending_sha256,reuses_sha256:protocol.body.reuses_sha256,
 configuration_sha256:protocol.body.configuration_sha256,scope:protocol.body.policy,consent_source:'user_directive_codex_delegation',
 directive,directive_sha256:await negativeHash(directive),expires_at:new Date(Date.now()+3600000).toISOString()};
const execution={id,kind:'jev_chill80_execution_v1',body,sha256:await hybridHash(body)},records:Target9Record[]=[];let calls=0;
const port:Chill80Port={load:()=>Promise.resolve({protocol,protocol_id:pid,execution,records:structuredClone(records)}),baseline:()=>Promise.resolve(input.baseline),
 reserve:async(_id,review)=>{const pos=protocol.body.pending.find(r=>r.review_id===review)!.position,kind='jev_chill80_attempt_'+String(pos).padStart(2,'0');
  if(records.some(r=>r.kind===kind))return null;const r={id:crypto.randomUUID(),kind,body:{review_id:review},sha256:await hybridHash({review_id:review})};
  if(records.some(r=>r.kind===kind))return null;records.push(r);return r.id;},
 save:async(kind,body)=>{const r={id:crypto.randomUUID(),kind,body,sha256:await hybridHash(body)};records.push(r);return r.id;},wake:()=>Promise.resolve()};
const mock:typeof fetch=(url,init)=>{if(url!=='https://api.typesafe.ai/v1/systemone'||init?.method!=='POST'||init.redirect!=='error')throw Error('WRONG_MOCK_ROUTE');
 calls++;const p=JSON.parse(String(init.body));if(Object.keys(p.state).join(',')!=='review_alias,analysis_text'||Object.keys(p.questions).length!==25)throw Error('WRONG_MOCK_PAYLOAD');
 return Promise.resolve(new Response(JSON.stringify({model:'jev-1.13.0',usage:{input_tokens:10,output_tokens:0},
  answers:Object.fromEntries(THEME_KEYS.map(k=>[k,{type:'choice',choice:'absent',probabilities:{absent:1,positive:0,negative:0,both:0}}]))})));};
const durations=[];for(let i=0;i<71;i++){const t=performance.now();if(await processChill80(port,id,'EXPLICIT_MOCK_KEY',mock)!=='completed_one')throw Error('MOCK_STEP_FAILED');durations.push(performance.now()-t);}
const start=performance.now();await processChill80(port,id,'EXPLICIT_MOCK_KEY',mock);const final_ms=performance.now()-start;
const archive=records.find(r=>r.kind==='jev_chill80_dataset_v1')!,a=archive.body as {analyses:unknown[];differences:unknown[];denominators:unknown};
if(calls!==71||a.analyses.length!==80||a.differences.length!==2000)throw Error('MOCK_FINALIZATION_FAILED');
if(await processChill80(port,id,'EXPLICIT_MOCK_KEY',mock)!==archive.id||calls!==71)throw Error('MOCK_FINALIZATION_IDEMPOTENCE_FAILED');
console.log(JSON.stringify({version:'jev-chill80-offline-qualification-v1',protocol_sha256:protocol.sha256,
 explicit_technical_mock:true,not_real_jev_predictions:true,supplier_calls:0,database_writes:0,
 simulated_requests:calls,retained_real_reuses:9,analysis_slots:a.analyses.length,comparison_cells:a.differences.length,
 denominators:a.denominators,maximum_wall_ms_per_mock_wake:Math.round(Math.max(...durations)),finalization_wall_ms:Math.round(final_ms),
 cpu_ms:null,measurement_limit:'Local wall time, not a measurement of deployed Edge CPU.',network_permission:'denied'}));
