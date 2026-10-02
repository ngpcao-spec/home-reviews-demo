/// <reference types="node" />
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

function worker() {
  const handlers:Record<string,(event:Record<string,unknown>)=>void>={}
  const fetch=vi.fn().mockResolvedValue(new Response('network'))
  const match=vi.fn().mockResolvedValue(new Response('cached shell'))
  const self={location:{origin:'https://app.test'},registration:{scope:'https://app.test/home/'},
    addEventListener:(name:string,handler:typeof handlers[string])=>{handlers[name]=handler},
    skipWaiting:vi.fn(),clients:{claim:vi.fn(),matchAll:vi.fn().mockResolvedValue([]),openWindow:vi.fn()},
  }
  runInNewContext(readFileSync(new URL('../../public/sw.js',import.meta.url),'utf8'),{
    self,URL,Response,fetch,caches:{open:async()=>({match,put:vi.fn(),addAll:vi.fn()}),match,keys:async()=>[]},
  })
  return{handlers,fetch,self}
}
describe('PWA shell cache',()=>{
  it('never intercepts Supabase, auth or other cross-origin requests',()=>{
    const {handlers,fetch}=worker(),respondWith=vi.fn()
    for(const url of ['https://project.supabase.co/rest/v1/reviews','https://app.test/api/private'])
      handlers.fetch({request:{method:'GET',url,mode:'cors'},respondWith})
    expect(respondWith).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
  })
  it('serves the cached app shell immediately without a network dependency or reload',async()=>{
    const {handlers,fetch,self}=worker()
    let result!:Promise<Response>
    handlers.fetch({request:{method:'GET',url:'https://app.test/home/',mode:'navigate'},respondWith:(value:Promise<Response>)=>{result=value}})
    expect(await (await result).text()).toBe('cached shell')
    expect(fetch).not.toHaveBeenCalled()
    expect(self.clients.openWindow).not.toHaveBeenCalled()
  })
})
