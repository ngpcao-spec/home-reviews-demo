import {act,renderHook,waitFor,cleanup} from '@testing-library/react'
import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {useDishSearch} from './use-dish-search'
const search=vi.hoisted(()=>vi.fn())
vi.mock('./restaurant-dishes',()=>({searchDishes:search}))
beforeEach(()=>{search.mockReset()})
afterEach(cleanup)
it('discards late results after a query change and does not show results from another account',async()=>{
 let finish!:(value:unknown)=>void
 search.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockResolvedValue([{establishmentId:'chicken'}])
 const {result,rerender}=renderHook(({query,scope})=>useDishSearch(query,scope),{initialProps:{query:'pho',scope:'a'}})
 await waitFor(()=>expect(search).toHaveBeenCalledTimes(1))
 rerender({query:'pho ga',scope:'a'})
 await waitFor(()=>expect(result.current.matches).toEqual([{establishmentId:'chicken'}]))
 await act(async()=>{finish([{establishmentId:'generic'}])})
 expect(result.current.matches).toEqual([{establishmentId:'chicken'}])
 search.mockResolvedValue([]);rerender({query:'pho ga',scope:'b'})
 expect(result.current.matches).toEqual([])
 await waitFor(()=>expect(result.current.loading).toBe(false))
 expect(result.current.matches).toEqual([])
})
it('requires an explicit retry after an RPC failure',async()=>{
 search.mockRejectedValueOnce(Error('unavailable')).mockResolvedValue([])
 const {result}=renderHook(()=>useDishSearch('pho','a'))
 await waitFor(()=>expect(result.current.error).toBe(true))
 expect(search).toHaveBeenCalledTimes(1)
 act(()=>result.current.retry())
 await waitFor(()=>expect(result.current.error).toBe(false))
 expect(search).toHaveBeenCalledTimes(2)
})
it('does not query the server when the dish query is empty',()=>{
 const {result}=renderHook(()=>useDishSearch('  ','a'))
 expect(result.current.loading).toBe(false);expect(search).not.toHaveBeenCalled()
})
