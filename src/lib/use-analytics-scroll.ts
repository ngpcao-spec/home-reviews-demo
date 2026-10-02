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
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastTop: number | undefined
    const schedule=()=>{
      if(!state.current.done) return
      lastTop=window.scrollY
      if(!timer)timer=setTimeout(()=>{timer=undefined;if(lastTop!==undefined)cache.saveScroll(key,lastTop)},150)
    }
    window.addEventListener('scroll',schedule,{passive:true})
    window.addEventListener('pagehide',save)
    document.addEventListener('visibilitychange',save)
    return ()=>{
      clearTimeout(timer)
      if(lastTop!==undefined)cache.saveScroll(key,lastTop)
      window.removeEventListener('scroll',schedule)
      window.removeEventListener('pagehide',save)
      document.removeEventListener('visibilitychange',save)
    }
  },[cache,key])
}
