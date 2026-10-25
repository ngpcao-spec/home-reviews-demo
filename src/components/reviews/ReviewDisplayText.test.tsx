import {act,cleanup,render,screen,waitFor,fireEvent} from '@testing-library/react'
import {afterEach,it,expect,vi} from 'vitest'
import {ReviewDisplayText} from './ReviewDisplayText'
import {I18nProvider} from '../../i18n'
import type {Review} from '../../types/domain'
import type {ReviewDisplay} from '../../lib/review-display'
const mock=vi.hoisted(()=>({read:vi.fn(),account:'user'}))
vi.mock('../../app/AppContext',()=>({useApp:()=>({currentUser:{id:mock.account},demoMode:false})}))
vi.mock('../../lib/supabase',()=>({supabase:{rpc:vi.fn()}}))
vi.mock('../../lib/review-display',()=>({readReviewDisplay:mock.read}))
const review={id:'review',originalText:'Very slow service.',reviewText:'OLD ENGLISH FALLBACK',reviewLanguage:'en'} as Review
const result=(status:string,language:'fr'|'vi'='fr',translated_text?:string):ReviewDisplay=>({review_id:'review',original_text:review.originalText!,source_sha256:'hash',language,status,translated_text})
afterEach(()=>{cleanup();vi.clearAllMocks();vi.useRealTimers();vi.unstubAllGlobals();mock.account='user'})
const ui=(language:'fr'|'vi'='fr',r=review)=><I18nProvider language={language}><ReviewDisplayText review={r}/></I18nProvider>
it.each([['fr','Service très lent.','Traduit en français','Voir l’original'],['vi','Phục vụ rất chậm.','Đã dịch sang tiếng Việt','Xem bản gốc']] as const)('displays verified %s translation and toggles to the intact original',async(language,text,badge,button)=>{
 mock.read.mockResolvedValue(result('translated',language,text));render(ui(language));expect(await screen.findByText(text)).toBeVisible();expect(screen.getByText(badge)).toBeVisible();fireEvent.click(screen.getByRole('button',{name:button}));expect(screen.getByText(review.originalText!)).toBeVisible()
})
it.each(['fr','vi'] as const)('shows a matching %s original without presenting it as a translation',async language=>{
 const text=language==='fr'?'Service très lent.':'Phục vụ rất chậm.';mock.read.mockResolvedValue({...result('original',language),original_text:text});render(ui(language,{...review,originalText:text}));await waitFor(()=>expect(mock.read).toHaveBeenCalled());expect(screen.getByText(text)).toBeVisible();expect(screen.queryByText(/Traduit en français|Đã dịch sang/)).toBeNull();expect(screen.queryByRole('button')).toBeNull()
})
it('shows original while pending, then refreshes when the translation becomes available',async()=>{
 vi.useFakeTimers();mock.read.mockResolvedValueOnce(result('queued')).mockResolvedValue(result('translated','fr','Service lent.'));render(ui());await act(async()=>{await vi.advanceTimersByTimeAsync(10)});expect(screen.getByText(review.originalText!)).toBeVisible();expect(screen.getByRole('status')).toHaveTextContent('traduction en préparation');await act(async()=>{await vi.advanceTimersByTimeAsync(3000)});expect(screen.getByText('Service lent.')).toBeVisible()
})
it('labels unknown or failed output explicitly without calling it a translation',async()=>{
 mock.read.mockResolvedValue({...result('unknown'),error_code:'TRANSLATION_OUTCOME_UNKNOWN'});render(ui());expect(await screen.findByText('Original · traduction indisponible')).toBeVisible();expect(screen.getByText(review.originalText!)).toBeVisible();expect(screen.queryByRole('button')).toBeNull()
})
it('never prepares a textless review',()=>{
 render(ui('fr',{...review,originalText:'',reviewText:''}));expect(mock.read).not.toHaveBeenCalled();expect(screen.queryByRole('status')).toBeNull()
})
it('ignores the old English display and rejects a cached result for another source revision',async()=>{
 mock.read.mockResolvedValue({...result('translated','fr','OLD TRANSLATION'),original_text:'Earlier source'});render(ui());expect(screen.queryByText('OLD ENGLISH FALLBACK')).toBeNull();expect(await screen.findByText('Original · traduction indisponible')).toBeVisible();expect(screen.queryByText('OLD TRANSLATION')).toBeNull()
})
it('switches account language without reimporting and discards the prior in-flight result',async()=>{
 let complete!:(r:ReviewDisplay)=>void
 mock.read.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve})).mockResolvedValue(result('translated','vi','Phục vụ chậm.'))
 const view=render(ui());await waitFor(()=>expect(mock.read).toHaveBeenCalledTimes(1));view.rerender(ui('vi'));expect(await screen.findByText('Phục vụ chậm.')).toBeVisible();await act(async()=>complete(result('translated','fr','Service lent.')));expect(screen.queryByText('Service lent.')).toBeNull();expect(mock.read).toHaveBeenLastCalledWith('user','vi','review')
})
it('invalidates the displayed revision and scopes requests to the signed-in account',async()=>{
 mock.read.mockResolvedValue(result('translated','fr','Service lent.'));const view=render(ui());expect(await screen.findByText('Service lent.')).toBeVisible()
 mock.read.mockResolvedValue({...result('queued'),original_text:'Changed original.'});mock.account='other';view.rerender(ui('fr',{...review,originalText:'Changed original.'}));expect(screen.queryByText('Service lent.')).toBeNull();await waitFor(()=>expect(mock.read).toHaveBeenLastCalledWith('other','fr','review'));expect(screen.getByText('Changed original.')).toBeVisible()
})
