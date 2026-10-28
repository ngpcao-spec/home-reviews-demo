// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest'
const mock=vi.hoisted(()=>({admin:null as unknown}))
vi.mock('npm:@supabase/supabase-js@2.117.2',()=>({createClient:()=>mock.admin}))
vi.mock('../_shared/push.ts',()=>({sendPushToUser:vi.fn()}))
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks()})

it.each([false,true])('uses the validated stage before any provider access (expired=%s)',async expired=>{
 const calls:string[]=[]
 const job={id:'job',organization_id:'org',user_id:'user',establishment_id:'place',expected_google_id:'synthetic',preferred_language:'vi',
  request_kind:'reload',status:'running',provider_run_id:'saved-run',provider_dataset_id:'saved-dataset',reviews_target:150,created_at:new Date().toISOString()}
 mock.admin={
  rpc:async(name:string)=>{
   calls.push(name)
   if(name==='review_reload_stage_ready')return expired?{data:null,error:{message:'RELOAD_VALIDATED_STAGE_EXPIRED'}}:{data:true,error:null}
   const data=name==='claim_initial_import_jobs'?[job]:name==='apply_review_reload'?{reload_replaced:true,inserted:150}:
    name==='fail_review_reload'?'failed':name==='claim_import_completion_pushes'?[]:true
   return {data,error:null}
  },
  from:(table:string)=>({select(){return this},eq(){return this},single:async()=>({data:table==='review_sync_runtime_config'?{provider_slot_count:2}: {enabled:true,paused:false,ingestions_paused:false},error:null})}),
 }
 const fetch=vi.fn().mockRejectedValue(Error('NETWORK_FORBIDDEN'))
 let handler!:(request:Request)=>Promise<Response>
 vi.stubGlobal('fetch',fetch)
 vi.stubGlobal('Deno',{env:{get:(name:string)=>{if(name.includes('APIFY')||name.includes('OPENAI')||name.includes('TYPESAFE'))throw Error('PROVIDER_ACCESS_FORBIDDEN');return 'SYNTHETIC'}},serve:(fn:typeof handler)=>{handler=fn}})
 vi.resetModules();await import('./index.ts')
 const response=await handler(new Request('https://worker.test',{method:'POST',body:'{}'}))
 expect(response.status).toBe(200);expect(fetch).not.toHaveBeenCalled()
 expect(calls).not.toContain('claim_review_provider_slot')
 expect(calls).not.toContain('reserve_review_provider_start')
 if(expired){expect(calls).toContain('fail_review_reload');expect(calls).not.toContain('apply_review_reload')}
 else {expect(calls).toContain('apply_review_reload');expect(calls).not.toContain('fail_review_reload')}
})
