import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ReviewReloadPanel } from './ReviewReloadPanel'
import { I18nProvider } from '../i18n'
import type { Establishment, PreferredLanguage } from '../types/domain'

const reload=vi.fn(),refresh=vi.fn()
vi.mock('../app/AppContext',()=>({useApp:()=>({reloadEstablishmentReviews:reload,refreshInitialImports:refresh,currentUser:{id:'user'},demoMode:false})}))
const place:Establishment={id:'place',organizationId:'org',name:'Restaurant',address:'',city:'',category:'',googleMapsUrl:'',
 currentRating:4.5,currentReviewCount:150,isActive:true,syncEnabled:true,lastSyncedAt:'',syncStatus:'ok'}
const ui=(lang:PreferredLanguage='fr',e=place)=><I18nProvider language={lang}><ReviewReloadPanel establishment={e}/></I18nProvider>
beforeEach(()=>{localStorage.clear();reload.mockReset().mockResolvedValue(undefined);refresh.mockReset().mockResolvedValue(undefined)})
afterEach(()=>{cleanup();vi.useRealTimers()})

it('never starts on mount; a double click uses one durable intent and the existing restaurant',async()=>{
 let done:()=>void=()=>{};reload.mockImplementation(()=>new Promise<void>(r=>{done=r}))
 render(ui());expect(reload).not.toHaveBeenCalled()
 await userEvent.dblClick(screen.getByRole('button',{name:'Recharger tous les avis'}))
 expect(reload).toHaveBeenCalledTimes(1);expect(reload.mock.calls[0][0]).toBe('place')
 expect(reload.mock.calls[0][1]).toMatch(/^[0-9a-f-]{36}$/)
 await act(async()=>done())
})
it.each([['fr','Réessayer','Notre système a rencontré un problème pour récupérer les avis.'],['vi','Thử lại','Hệ thống gặp sự cố khi thu thập đánh giá.']] as const)('localizes errors in %s and reuses a lost-response intent on manual Retry',async(lang,button,error)=>{
 reload.mockRejectedValue(Error('APIFY_START_OUTCOME_UNKNOWN: secret detail'))
 const view=render(ui(lang));await userEvent.click(screen.getByRole('button'))
 expect(screen.getByRole('alert')).toHaveTextContent(error)
 const first=reload.mock.calls[0][1];view.unmount()
 render(ui(lang));expect(reload).toHaveBeenCalledTimes(1)
 await userEvent.click(screen.getByRole('button'))
 expect(reload.mock.calls[1][1]).toBe(first)
 expect(screen.getByRole('button',{name:button})).toBeEnabled()
 expect(document.body).not.toHaveTextContent(/Apify|secret detail|UNKNOWN/i)
})
it('observes a running reload read-only and makes the normal manual-report option clear on success',async()=>{
 vi.useFakeTimers();const requestId=crypto.randomUUID();localStorage.setItem('review-reload:user:place',requestId)
 const view=render(ui('fr',{...place,reviewReload:{requestId,status:'running'}}))
 await act(async()=>vi.advanceTimersByTimeAsync(6000));expect(refresh).toHaveBeenCalledTimes(2)
 expect(reload).not.toHaveBeenCalled();expect(screen.getByRole('button')).toBeDisabled()
 view.rerender(ui('fr',{...place,currentReviewCount:5,reviewReload:{requestId,status:'completed',count:5}}))
 expect(screen.getByRole('status')).toHaveTextContent('5 avis disponibles. Vous pouvez générer un nouveau rapport.')
 expect(localStorage.getItem('review-reload:user:place')).toBeNull();expect(reload).not.toHaveBeenCalled()
 view.rerender(ui('vi',{...place,currentReviewCount:5,reviewReload:{requestId,status:'completed',count:5}}))
 expect(screen.getByRole('status')).toHaveTextContent('Có 5 đánh giá.')
})

it('the Retry button after a confirmed SQL failure sends a new manual intent for the same restaurant, without retrying on mount',async()=>{
 const previous=crypto.randomUUID();localStorage.setItem('review-reload:user:place',previous)
 render(ui('fr',{...place,reviewReload:{jobId:'saved-stage-job',requestId:previous,status:'failed'}}))
 expect(reload).not.toHaveBeenCalled();expect(localStorage.getItem('review-reload:user:place')).toBeNull()
 await userEvent.click(screen.getByRole('button',{name:'Réessayer'}))
 expect(reload).toHaveBeenCalledTimes(1);expect(reload.mock.calls[0][0]).toBe(place.id)
 expect(reload.mock.calls[0][1]).not.toBe(previous)
})
