// @vitest-environment node
import {PGlite} from '@electric-sql/pglite'
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto'
import {readFileSync,readdirSync} from 'node:fs'
import {beforeAll,beforeEach,afterEach,afterAll,it,expect,vi} from 'vitest'
import {isolatedEnglishStep,type ExperimentPort} from '../../supabase/functions/khouse-english-experiment/runner'
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text'
let db:PGlite,deny:ReturnType<typeof vi.spyOn>
const id='10000000-0000-4000-8000-000000000001',worker='20000000-0000-4000-8000-000000000002'
const sql=readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(s=>s.endsWith('_khouse_english_isolated_experiment.sql')),'utf8')
beforeAll(async()=>{db=new PGlite({extensions:{pgcrypto}});await db.waitReady;await db.exec('create schema private;create schema extensions;create extension pgcrypto with schema extensions;create role anon;create role authenticated;create role service_role;');await db.exec(sql)},30000)
beforeEach(async()=>{deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'));await db.exec('begin');await db.query("insert into private.kh_en_experiments(id,reference_report_id,establishment_id,armed,expires_at,body) values($1,$1,$1,true,now()+interval '1 day','{}')",[id]);await db.query("insert into private.kh_en_calls(experiment_id,phase,request_wire,request_sha256) select $1,phase,'{}',encode(extensions.digest('{}','sha256'),'hex') from unnest(array['apify','jev_1','jev_2','jev_3','sol']) phase",[id])})
afterEach(async()=>{await db.exec('rollback');expect(deny).not.toHaveBeenCalled();deny.mockRestore()})
afterAll(()=>db.close())
const claim=async(phase:string)=>(await db.query('select public.kh_en_claim($1,$2,$3) r',[id,phase,worker])).rows[0].r
const receive=async(phase:string,raw:string|null)=>db.query("select public.kh_en_receive($1,$2,$3,jsonb_build_object('request_sha256',encode(extensions.digest('{}','sha256'),'hex'),'raw_response_text',$4::text,'http_status',200)) ok",[id,phase,worker,raw])
it('new tables are private and only the server can call the experiment RPCs',async()=>{
 expect((await db.query("select has_function_privilege('authenticated','public.kh_en_claim(uuid,text,uuid)','execute') a,has_function_privilege('anon','public.kh_en_read(uuid)','execute') b,has_function_privilege('service_role','public.kh_en_read(uuid)','execute') c")).rows[0]).toEqual({a:false,b:false,c:true})
})
it('reserves once durably and never resends a consumed unknown attempt',async()=>{
 expect(await claim('apify')).toMatchObject({attempts:1,state:'reserved'});expect(await claim('apify')).toBeNull();await receive('apify',null);expect(await claim('apify')).toBeNull();expect((await db.query('select state,attempts from private.kh_en_calls where phase=\'apify\'')).rows[0]).toEqual({state:'unknown',attempts:1})
})
it('requires full coverage before JEV and all three real receipts before Sol',async()=>{
 await db.exec('savepoint gate');await expect(claim('jev_1')).rejects.toThrow('EXPERIMENT_COVERAGE_REQUIRED');await db.exec('rollback to savepoint gate')
 await db.query("update private.kh_en_experiments set artifacts='{"+'"coverage":{"complete":true},"analysis_ready":true'+"}' where id=$1",[id])
 for(const phase of ['jev_1','jev_2']){await claim(phase);await receive(phase,'{}')}
 await db.exec('savepoint sol');await expect(claim('sol')).rejects.toThrow('EXPERIMENT_THREE_JEV_RECEIPTS_REQUIRED');await db.exec('rollback to savepoint sol')
 await claim('jev_3');await receive('jev_3','{}');expect(await claim('sol')).toMatchObject({attempts:1});expect(await claim('sol')).toBeNull()
})
it('disarming prevents every new reservation',async()=>{await db.exec('update private.kh_en_experiments set armed=false');expect(await claim('apify')).toBeNull()})
it('transport preserves a single unknown POST and does not retry or fall back',async()=>{
 const wire=JSON.stringify({language:'en',maxReviews:300,reviewsSort:'newest',reviewsOrigin:'google',startUrls:[{url:'https://www.google.com/maps?cid=10272778536914778056'}]})
 const c={phase:'apify',state:'prepared',attempts:0,request_wire:wire,request_sha256:await analysisTextSha256(wire)},http=vi.fn().mockRejectedValue(Error('LOST_RESPONSE'))
 const port:ExperimentPort={read:async()=>({experiment:{id,armed:true,expires_at:new Date(Date.now()+60000).toISOString(),artifacts:{}},calls:[c]}),claim:async()=>{if(c.attempts)return null;c.attempts=1;c.state='reserved';return c},receive:async(_id,_phase,_w,r)=>{c.state=r.raw_response_text===null?'unknown':'received';return true},artifact:async()=>true}
 expect(await isolatedEnglishStep(port,id,'apify',{apify:'test-key',jev:'',sol:''},http)).toMatchObject({provider_calls:1,outcome:'unknown'});expect(await isolatedEnglishStep(port,id,'apify',{apify:'test-key',jev:'',sol:''},http)).toMatchObject({provider_calls:0,consumed:true});expect(http).toHaveBeenCalledTimes(1);expect(http.mock.calls[0][1].body).toBe(wire)
})
