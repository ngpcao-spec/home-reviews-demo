import {describe,it,expect,vi,afterEach} from 'vitest'
import {syntheticV12} from '../../../tests/fixtures/jev-v12'
import {V13_BENCH_CONFIG,V13_FIRST_SOURCE} from '../_shared/jev-v13-core'
import {negativeHash} from '../_shared/negative-validation-core'
import {canonicalJson} from '../_shared/jev-exploratory-core'
const state=vi.hoisted(()=>({context:null as unknown,allowed:true}))
vi.mock('../_shared/auth.ts',()=>({requireUser:async()=>state.context,assertMembership:async()=>{if(!state.allowed)throw new Error('FORBIDDEN')}}))
vi.mock('../_shared/rate-limit.ts',()=>({enforceRateLimit:vi.fn()}))
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();state.allowed=true})
describe('real V13 endpoint with mocked database only',()=>{
 it('previews the compatible first replay without starting, then denies another tenant before reading source content',async()=>{const f=await syntheticV12();f.run.id=V13_FIRST_SOURCE;const tasks=f.v12Tasks.map(t=>({...t,run_id:f.run.id,model_version:'v12',review_alias:'r'+f.prepared.items.find(i=>i.review_id===t.review_id)!.position,question_set:'themes_v12_semantic_boundaries_v1',analysis_text_sha256:f.prepared.items.find(i=>i.review_id===t.review_id)!.analysis_text_sha256})),tables:Record<string,unknown[]>={analysis_jev_v12_runs:[f.run],analysis_jev_v13_runs:[],analysis_jev_v13_sealed_inputs:[],analysis_jev_v13_configurations:[{id:V13_BENCH_CONFIG.id,config:V13_BENCH_CONFIG,config_sha256:await negativeHash(canonicalJson(V13_BENCH_CONFIG)),frozen_at:'2026-10-10'}]},rpc=vi.fn(async(name:string)=>({data:name==='read_jev_v13_source'?{run:f.run,tasks,input_rate:.042,output_rate:0}:null,error:null}));
 class Query {constructor(private table:string){}select(){return this}eq(){return this}limit(){return this}single(){return Promise.resolve({data:tables[this.table]?.[0]??null,error:null})}maybeSingle(){return this.single()}then(resolve:(r:unknown)=>unknown){return Promise.resolve({data:tables[this.table]??[],error:null}).then(resolve)}}
 state.context={user:{id:'owner'},client:{},admin:{from:(table:string)=>new Query(table),rpc}};let handler:(r:Request)=>Promise<Response>=async()=>new Response();vi.stubGlobal('Deno',{env:{get:(key:string)=>key==='TYPESAFE_API_KEY'?'fake':undefined},serve:(fn:typeof handler)=>{handler=fn}});await import('./index.ts');const response=await handler(new Request('https://fixture/experimental-jev-v13?source=development_first')),data=await response.json();expect(data.error_code).toBeNull();expect(data.ready).toBe(true);expect(data.preview).toMatchObject({reviews:30,expected_requests:90,reused_v12_responses:90,new_v12_requests:0,independent_for_v13:false});expect(rpc.mock.calls.every(([name])=>name==='read_jev_v13_source')).toBe(true);state.allowed=false;rpc.mockClear();expect((await handler(new Request('https://fixture/experimental-jev-v13'))).status).toBe(403);expect(rpc).not.toHaveBeenCalled()
 })
})
