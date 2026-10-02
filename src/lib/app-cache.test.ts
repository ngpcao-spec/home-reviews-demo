import { describe, expect, it } from 'vitest'
import { cacheGeneration, purgeAppCache, readAppCache, validAppCache } from './app-cache'
const record=()=>({version:1,userId:'a',organizationIds:['org-a'],cachedAt:Date.now(),data:{
  establishments:[],reviews:[],notifications:[],initialImportJobs:[],monitoringIntervalHours:12,preferredLanguage:'vi',
}})
describe('account cache validation',()=>{
  it('accepts empty-but-successfully-loaded data and separates users',()=>{
    expect(validAppCache(record(),'a')).toBe(true)
    expect(validAppCache(record(),'b')).toBe(false)
  })
  it('rejects expired, corrupt, and foreign-tenant snapshots',()=>{
    expect(validAppCache({...record(),cachedAt:0},'a')).toBe(false)
    expect(validAppCache({...record(),version:2},'a')).toBe(false)
    const mixed={...record(),data:{...record().data,establishments:[{id:'e',organizationId:'org-b'}]}}
    expect(validAppCache(mixed,'a')).toBe(false)
  })
  it('degrades gracefully without IndexedDB and invalidates delayed writes on logout',async()=>{
    const before=cacheGeneration('a')
    await purgeAppCache('a')
    expect(cacheGeneration('a')).toBe(before+1)
    expect(await readAppCache('a')).toBeUndefined()
  })
})
