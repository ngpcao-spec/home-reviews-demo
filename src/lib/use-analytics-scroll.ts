import { useLayoutEffect, useRef } from 'react'
import type { AnalyticsSessionCache } from './analytics-cache'

export function useAnalyticsScroll(cache:AnalyticsSessionCache,key:string,ready:boolean) {
  const state=useRef({key,restore:true,done:false})
  useLayoutEffect(()=>{
    if(state.current.key!==key) state.current={key,restore:false,done:false}
    if(!key || state.current.done || !ready && state.current.restore) return
    const top=state.current.restore?cache.getScroll(key):0
    const frame=requestAnimationFrame(()=>{
      window.scrollTo({top,behavior:'instant'})
      state.current.done=true
    })
    return ()=>cancelAnimationFrame(frame)
  },[cache,key,ready])
  useLayoutEffect(()=>{
    if(!key) return
    const save=()=>{if(state.current.done)cache.saveScroll(key,window.scrollY)}
    window.addEventListener('scroll',save,{passive:true})
    return ()=>window.removeEventListener('scroll',save)
  },[cache,key])
}
