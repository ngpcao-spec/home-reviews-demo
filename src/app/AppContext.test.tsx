import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppProvider, useApp } from './AppContext'

describe('workflow démo intégré',()=>{
  beforeEach(()=>localStorage.clear())
  it('injecte un avis 1★ et une notification, puis le traite',()=>{const {result}=renderHook(()=>useApp(),{wrapper:AppProvider});const beforeReviews=result.current.reviews.length;const beforeNotifications=result.current.notifications.length;let id='';act(()=>{id=result.current.injectNegativeReview()});expect(result.current.reviews).toHaveLength(beforeReviews+1);expect(result.current.notifications).toHaveLength(beforeNotifications+1);expect(result.current.reviews.find((item)=>item.id===id)?.status).toBe('to_process');act(()=>result.current.markProcessed(id));expect(result.current.reviews.find((item)=>item.id===id)?.status).toBe('processed')})
  it('génère une réponse et journalise l’action',async()=>{const {result}=renderHook(()=>useApp(),{wrapper:AppProvider});let response='';await act(async()=>{response=await result.current.generateResponse('r1')});expect(response).toContain('merci');expect(result.current.actions.some((item)=>item.reviewId==='r1'&&item.actionType==='response_generated')).toBe(true)})
  it('supprime un établissement et ses données associées en démo',async()=>{const {result}=renderHook(()=>useApp(),{wrapper:AppProvider});const establishmentId=result.current.establishments[0].id;expect(result.current.reviews.some((item)=>item.establishmentId===establishmentId)).toBe(true);await act(async()=>{await result.current.removeEstablishment(establishmentId)});expect(result.current.establishments.some((item)=>item.id===establishmentId)).toBe(false);expect(result.current.reviews.some((item)=>item.establishmentId===establishmentId)).toBe(false);expect(result.current.notifications.some((item)=>item.establishmentId===establishmentId)).toBe(false)})
})
