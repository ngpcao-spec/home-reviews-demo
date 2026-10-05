import { afterEach,describe,expect,it,vi } from 'vitest'
const auth=vi.hoisted(()=>({requireUser:vi.fn(),assertMembership:vi.fn()}))
vi.mock('../_shared/auth.ts',()=>auth)
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks()})
async function harness(mode='normal'){
  const run={establishment_id:'place',organization_id:'org',language:'vi',generation_id:'one-generation',status:'queued',cursor:0,total_steps:null,snapshot:{}}
  const query=(table:string)=>({select(){return this},eq(){return this},
    single:async()=>({data:table==='establishments'?{id:'place',organization_id:'org'}:{preferred_language:'vi'},error:null}),
    maybeSingle:async()=>({data:run,error:null})})
  const rpc=vi.fn(async()=>({data:run,error:null}))
  const database={from:vi.fn(query),rpc}
  auth.requireUser.mockImplementation(async()=>{if(mode==='unauthorized')throw new Error('UNAUTHORIZED');return {client:database,admin:database,user:{id:'user'}}})
  auth.assertMembership.mockImplementation(async()=>{if(mode==='forbidden')throw new Error('FORBIDDEN')})
  let handler!:(r:Request)=>Promise<Response>
  vi.stubGlobal('Deno',{env:{get:()=> 'gpt-6.1-sol'},serve:(fn:typeof handler)=>{handler=fn}})
  vi.resetModules();await import('./index.ts')
  return {rpc,database,call:(body:object={establishment_id:'place',preferred_language:'vi'})=>handler(new Request('https://example.test',{method:'POST',body:JSON.stringify(body)}))}
}
describe('enqueue-only user endpoint',()=>{
  it('concurrent clicks use transactional enqueue and return the same run, without fetching reviews/AI',async()=>{
    const h=await harness()
    const replies=await Promise.all([h.call(),h.call()])
    expect(replies.map(r=>r.status)).toEqual([202,202])
    for(const reply of replies)expect(await reply.json()).toMatchObject({run:{generation_id:'one-generation',status:'queued'}})
    expect(h.rpc).toHaveBeenCalledWith('enqueue_historical_report',{p_establishment_id:'place',p_organization_id:'org',p_user_id:'user',p_language:'vi',p_model:'gpt-6.1-sol',p_analysis_version:6})
    expect(h.database.from.mock.calls.map(call=>call[0])).not.toContain('reviews')
  })
  it.each([['unauthorized',401],['forbidden',403]])('rejects %s without enqueuing',async(mode,status)=>{
    const h=await harness(mode);expect((await h.call()).status).toBe(status);expect(h.rpc).not.toHaveBeenCalled()
  })
  it('legacy generation_id continuation is read-only and never advances a cursor',async()=>{
    const h=await harness()
    expect((await h.call({establishment_id:'place',generation_id:'one-generation'})).status).toBe(200)
    expect(h.rpc).not.toHaveBeenCalled()
  })
  it('rejects a stale interface language instead of analyzing another language',async()=>{
    const h=await harness();expect((await h.call({establishment_id:'place',preferred_language:'fr'})).status).toBe(409)
    expect(h.rpc).not.toHaveBeenCalled()
  })
})
