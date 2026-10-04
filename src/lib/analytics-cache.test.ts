import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsSessionCache, analyticsSession, resetAnalyticsCache, resolveAnalyticsSelection } from './analytics-cache'
import { buildDemoHistoricalReport } from './historical-report'
import { shabuReport } from '../../tests/fixtures/consultant-v5'

const report=(language:'fr'|'vi'='vi')=>buildDemoHistoricalReport('artisan',[],language,4.8,1615)
afterEach(()=>{vi.useRealTimers();resetAnalyticsCache()})
describe('analytics session cache',()=>{
  it('repairs an old frontend projection of V5 at the same row ID and revision without generation',async()=>{
    const cache=new AnalyticsSessionCache()
    const old={...report(),reputation:undefined,consultant:undefined}
    const revision='2026-10-04T22:39:20.142Z'
    cache.put('historical:artisan:vi',old,revision)
    const fresh={...old,consultant:shabuReport('vi')}
    const read=vi.fn(async()=>({report:fresh,revision}))
    await cache.load('historical:artisan:vi',read,{force:true,revalidate:true})
    expect(read).toHaveBeenCalledTimes(1)
    expect(cache.getSnapshot().entries['historical:artisan:vi'].report).toBe(fresh)
    expect(cache.getSnapshot().entries['historical:artisan:vi'].report).toMatchObject({consultant:{version:5}})
    cache.put('historical:artisan:vi',structuredClone(fresh),revision)
    expect(cache.getSnapshot().entries['historical:artisan:vi'].report).toBe(fresh)
  })
  it('keeps user and language caches separate and clears on sign-out',()=>{
    const cache=analyticsSession('account-a')
    cache.put('historical:artisan:vi',report())
    expect(analyticsSession('account-a')).toBe(cache)
    expect(cache.getSnapshot().entries['historical:artisan:fr']).toBeUndefined()
    expect(analyticsSession('account-b').getSnapshot().entries).toEqual({})
    resetAnalyticsCache()
    cache.put('late-response',report())
    expect(analyticsSession('account-a').getSnapshot().entries).toEqual({})
  })
  it('deduplicates concurrent reads and revalidates silently after 30 seconds',async()=>{
    vi.useFakeTimers();vi.setSystemTime(10_000)
    const cache=new AnalyticsSessionCache(),item=report()
    const loader=vi.fn(async()=>({report:item,revision:'v1'}))
    await Promise.all([cache.load('historical:artisan:vi',loader,{revalidate:true}),cache.load('historical:artisan:vi',loader,{revalidate:true})])
    expect(loader).toHaveBeenCalledTimes(1)
    await cache.load('historical:artisan:vi',loader,{revalidate:true})
    expect(loader).toHaveBeenCalledTimes(1)
    vi.setSystemTime(41_000)
    const next=cache.load('historical:artisan:vi',loader,{revalidate:true})
    expect(cache.getSnapshot().entries['historical:artisan:vi']).toMatchObject({report:item,loading:true})
    await next
    expect(cache.getSnapshot().entries['historical:artisan:vi'].report).toBe(item)
    expect(loader).toHaveBeenCalledTimes(2)
  })
  it('does not overwrite a newer manual report with a delayed background read',async()=>{
    const cache=new AnalyticsSessionCache()
    let resolve!:(value:{report:ReturnType<typeof report>;revision:string})=>void
    const pending=cache.load('key',()=>new Promise(done=>{resolve=done}))
    await Promise.resolve()
    const newer=report();cache.put('key',newer,'new')
    resolve({report:report(),revision:'old'});await pending
    expect(cache.getSnapshot().entries.key.report).toBe(newer)
  })
  it('retains a cached report when background reading fails',async()=>{
    const cache=new AnalyticsSessionCache(),item=report()
    cache.put('key',item)
    await cache.load('key',async()=>{throw new Error('offline')},{force:true})
    expect(cache.getSnapshot().entries.key).toMatchObject({report:item,loading:false,error:true})
  })
  it('retains scroll per view and never writes report data to local storage',()=>{
    const cache=new AnalyticsSessionCache(),write=vi.spyOn(Storage.prototype,'setItem')
    cache.saveScroll('artisan:historical:vi',1234)
    cache.put('historical:artisan:vi',report())
    expect(cache.getScroll('artisan:historical:vi')).toBe(1234)
    expect(cache.getScroll('green:historical:vi')).toBe(0)
    expect(write).not.toHaveBeenCalled();write.mockRestore()
  })
})
describe('analytics URL selection',()=>{
  const saved={establishmentId:'artisan',mode:'historical' as const}
  it('restores last session selection for a bare tab URL',()=>{
    expect(resolveAnalyticsSelection(new URLSearchParams(),saved,['green','artisan'])).toEqual(saved)
  })
  it('honors explicit URLs and rejects inaccessible IDs/invalid modes',()=>{
    expect(resolveAnalyticsSelection(new URLSearchParams('establishment=green&mode=current'),saved,['green','artisan'])).toEqual({establishmentId:'green',mode:'current'})
    expect(resolveAnalyticsSelection(new URLSearchParams('establishment=foreign&mode=invalid'),saved,['green'])).toEqual({establishmentId:'green',mode:'completed'})
    expect(resolveAnalyticsSelection(new URLSearchParams(),saved,['green'])).toEqual({establishmentId:'green',mode:'historical'})
  })
})
