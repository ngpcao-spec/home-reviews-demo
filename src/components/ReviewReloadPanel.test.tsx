import { act, cleanup, render, screen } from '@testing-library/react'
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

it.each(['fr','vi'] as const)('renders no panel or action when no reload is active or recorded (%s)',lang=>{
 const view=render(ui(lang))
 expect(view.container).toBeEmptyDOMElement()
 view.rerender(ui(lang,{...place,reviewReload:{status:'idle'}}))
 expect(view.container).toBeEmptyDOMElement()
 expect(reload).not.toHaveBeenCalled()
})
it('observes a running reload read-only and makes the normal manual-report option clear on success',async()=>{
 vi.useFakeTimers();const requestId=crypto.randomUUID();localStorage.setItem('review-reload:user:place',requestId)
 const view=render(ui('fr',{...place,reviewReload:{requestId,status:'running'}}))
 await act(async()=>vi.advanceTimersByTimeAsync(6000));expect(refresh).toHaveBeenCalledTimes(2)
 expect(reload).not.toHaveBeenCalled();expect(screen.queryByRole('button')).not.toBeInTheDocument()
 view.rerender(ui('fr',{...place,currentReviewCount:5,reviewReload:{requestId,status:'completed',count:5}}))
 expect(screen.getByRole('status')).toHaveTextContent('5 avis disponibles. Vous pouvez générer un nouveau rapport.')
 expect(localStorage.getItem('review-reload:user:place')).toBeNull();expect(reload).not.toHaveBeenCalled()
 await act(async()=>vi.advanceTimersByTimeAsync(6000));expect(refresh).toHaveBeenCalledTimes(2)
 view.rerender(ui('vi',{...place,currentReviewCount:5,reviewReload:{requestId,status:'completed',count:5}}))
 expect(screen.getByRole('status')).toHaveTextContent('Có 5 đánh giá.')
})

it('shows an existing failure without offering another reload',()=>{
 const previous=crypto.randomUUID();localStorage.setItem('review-reload:user:place',previous)
 render(ui('fr',{...place,reviewReload:{jobId:'saved-stage-job',requestId:previous,status:'failed'}}))
 expect(reload).not.toHaveBeenCalled();expect(localStorage.getItem('review-reload:user:place')).toBeNull()
 expect(screen.getByRole('alert')).toBeVisible()
 expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
