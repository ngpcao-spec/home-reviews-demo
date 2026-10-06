import { afterEach,describe,expect,it,vi } from 'vitest'
import { jevApi,launchJevOnce,readJevReference,saveJevReference,rememberJevRun,costComparison,latencyRatio } from './jev-benchmark'
import { jevResult,jevSource } from '../../tests/fixtures/jev-benchmark'
const invoke=vi.hoisted(()=>vi.fn())
const members=vi.hoisted(()=>vi.fn())
vi.mock('./supabase',()=>({supabase:{functions:{invoke},from:()=>({select:()=>({eq:()=>({in:members})})})}}))
afterEach(()=>{localStorage.clear();vi.restoreAllMocks();invoke.mockReset();members.mockReset()})
describe('Jev browser API and launch protection',()=>{
  it('calls only the dedicated Supabase function, with fixed manual parameters',async()=>{
    invoke.mockResolvedValue({data:{benchmark_id:'id'},error:null})
    await jevApi.post(jevSource.source_generation_id)
    expect(invoke).toHaveBeenCalledExactlyOnceWith('benchmark-jev-historical-analysis',{method:'POST',body:{source_generation_id:jevSource.source_generation_id,repeat_count:3,concurrency:8,model:'jev-latest'}})
  })
  it('all discovery, latest and polling operations use GET',async()=>{
    invoke.mockResolvedValue({data:{establishments:[],benchmark:null},error:null})
    await jevApi.sources();await jevApi.latest('source');await jevApi.read('id')
    expect(invoke.mock.calls.map(c=>c[1].method)).toEqual(['GET','GET','GET'])
    expect(invoke.mock.calls.every(c=>c[0].startsWith('benchmark-jev-historical-analysis'))).toBe(true)
  })
  it('B: double tap/remount launches once and stores id scoped to user + source',async()=>{
    let resolve!:(id:{benchmark_id:string})=>void
    vi.spyOn(jevApi,'latest').mockResolvedValue(null)
    const post=vi.spyOn(jevApi,'post').mockImplementation(()=>new Promise(r=>{resolve=r}))
    vi.spyOn(jevApi,'read').mockResolvedValue(jevResult)
    const first=launchJevOnce('user',jevSource.source_generation_id)
    await expect(launchJevOnce('user',jevSource.source_generation_id)).rejects.toThrow('JEV_LAUNCH_PENDING')
    await vi.waitFor(()=>expect(post).toHaveBeenCalledTimes(1))
    resolve({benchmark_id:jevResult.id});await first
    expect(readJevReference('user',jevSource.source_generation_id)?.benchmark_id).toBe(jevResult.id)
    expect(readJevReference('other',jevSource.source_generation_id)).toBeNull()
  })
  it.each(['running','completed'] as const)('existing %s prevents any new POST',async status=>{
    vi.spyOn(jevApi,'latest').mockResolvedValue({...jevResult,status});const post=vi.spyOn(jevApi,'post')
    const result=await launchJevOnce('user',jevSource.source_generation_id)
    expect(result?.status).toBe(status);expect(post).not.toHaveBeenCalled()
  })
  it('ambiguous network outcome survives reload and prevents relaunch',async()=>{
    vi.spyOn(jevApi,'latest').mockResolvedValue(null)
    const post=vi.spyOn(jevApi,'post').mockRejectedValue(new Error('JEV_CONNECTION_ERROR'))
    await expect(launchJevOnce('user','source')).rejects.toThrow('JEV_CONNECTION_ERROR')
    expect(readJevReference('user','source')?.pending).toBe(true)
    await expect(launchJevOnce('user','source')).rejects.toThrow('JEV_LAUNCH_PENDING');expect(post).toHaveBeenCalledTimes(1)
  })
  it('a failed run is rechecked and can retry only explicitly',async()=>{
    const latest=vi.spyOn(jevApi,'latest').mockResolvedValue({...jevResult,status:'failed'})
    const post=vi.spyOn(jevApi,'post').mockResolvedValue({benchmark_id:'new-id'})
    vi.spyOn(jevApi,'read').mockResolvedValue({...jevResult,id:'new-id',status:'running'})
    await launchJevOnce('user','source');expect(latest).toHaveBeenCalledBefore(post);expect(post).toHaveBeenCalledTimes(1)
  })
  it('JEV_NOT_CONFIGURED is displayed as a code and does not keep a launch lock',async()=>{
    invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({error:'JEV_NOT_CONFIGURED'}),{status:503})}})
    await expect(jevApi.post('source')).rejects.toThrow('JEV_NOT_CONFIGURED')
    vi.spyOn(jevApi,'latest').mockResolvedValue(null)
    vi.spyOn(jevApi,'post').mockRejectedValue(new Error('JEV_NOT_CONFIGURED'))
    await expect(launchJevOnce('user','source')).rejects.toThrow('JEV_NOT_CONFIGURED');expect(readJevReference('user','source')).toBeNull()
  })
  it('storage errors prevent POST, while server-run display remains possible',async()=>{
    vi.spyOn(jevApi,'latest').mockResolvedValue(null);const post=vi.spyOn(jevApi,'post')
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('storage blocked')})
    await expect(launchJevOnce('user','source')).rejects.toThrow('storage blocked');expect(post).not.toHaveBeenCalled()
    expect(()=>rememberJevRun('user',jevResult)).not.toThrow()
  })
  it('stores only a lightweight reference, never tokens, review text or comparison',()=>{
    saveJevReference('user','source',{benchmark_id:'id',created_at:'today',pending:false})
    expect(JSON.parse(localStorage.getItem('jev-benchmark:user:source')!)).toEqual({benchmark_id:'id',created_at:'today',pending:false})
  })
  it('access queries only permitted membership roles',async()=>{
    members.mockResolvedValue({data:[{role:'manager'}],error:null});expect(await jevApi.access('user')).toBe(true)
    expect(members).toHaveBeenCalledWith('role',['owner','admin','manager'])
    members.mockResolvedValue({data:[],error:null});expect(await jevApi.access('user')).toBe(false)
  })
  it('cost/time ratios handle zero values without fabricated percentages',()=>{
    expect(costComparison(.02,.1)).toEqual({share:.19999999999999998,savings:.8})
    expect(costComparison(0,0)).toBeNull();expect(latencyRatio(0,100)).toBeNull();expect(latencyRatio(10,100)).toBe(10)
  })
})
