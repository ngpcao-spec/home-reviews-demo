import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react'
import {I18nProvider} from '../i18n'
import {ExperimentalReport} from './ExperimentalReport'
import {experimentalNegativeReviews} from '../lib/experimental-negative-reviews'
import {parallelPresentationRow} from '../../tests/fixtures/parallel-presentation'
import type {Axis} from '../../supabase/functions/_shared/consultant-contract'

beforeEach(()=>vi.spyOn(window,'scrollTo').mockImplementation(()=>{}))
afterEach(()=>{cleanup();vi.restoreAllMocks()})
const draw=(language:'fr'|'vi',row=parallelPresentationRow(language))=>render(<I18nProvider language={language}><ExperimentalReport row={row} methodology="EXPLICIT MOCK"/></I18nProvider>)
it.each(['service','quality','price','atmosphere'] as Axis[])('uses all saved negative/mixed IDs for %s, independently of selected quotes',axis=>{
 const row=parallelPresentationRow('fr'),before=JSON.stringify(row),data=experimentalNegativeReviews(row,axis)
 expect(data.available).toBe(true);expect(data.reviews).toHaveLength(2);expect(data.reviews.map(r=>r.classification)).toEqual(['mixed','negative'])
 expect(data.reviews.some(r=>r.source.id==='review-never-selected')).toBe(true);expect(data.reviews.some(r=>r.source.id==='review-positive-only')).toBe(false)
 expect(JSON.stringify(row)).toBe(before)
})
it('deduplicates IDs and sources, while allowing one review in several categories',()=>{
 const row=parallelPresentationRow('fr');row.statistics!.counts.categories.service.negative_review_ids!.push('review-never-selected');row.source_reviews.push(row.source_reviews.find(r=>r.id==='review-never-selected')!)
 expect(experimentalNegativeReviews(row,'service').reviews).toHaveLength(2);expect(experimentalNegativeReviews(row,'service').countMismatch).toBe(false)
 expect(experimentalNegativeReviews(row,'price').reviews.some(r=>r.source.id==='review-never-selected')).toBe(true)
})
it.each(['fr','vi'] as const)('opens a readable translated panel, marks mixed, and restores scroll/focus on close (%s)',language=>{
 const row=parallelPresentationRow(language),before=JSON.stringify(row),deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'))
 const {container}=draw(language),axis=container.querySelector<HTMLElement>('.v5-axis[data-axis="service"]')!
 expect(within(axis).queryByRole('button',{name:language==='fr'?'Consulter les avis sources':'Xem đánh giá nguồn'})).toBeNull()
 const trigger=within(axis).getByRole('button',{name:language==='fr'?'Avis négatifs, mixtes inclus : 2 — Service':'Đánh giá tiêu cực, gồm hỗn hợp : 2 — Dịch vụ'})
 trigger.focus();fireEvent.click(trigger);const panel=screen.getByRole('dialog')
 expect(within(panel).getByText('FULL NEGATIVE REVIEW OUTSIDE THE SELECTED QUOTATIONS.')).toBeVisible()
 expect(within(panel).getByText('EXISTING TRANSLATION OF THE UNSELECTED REVIEW.')).toBeVisible()
 expect(within(panel).getByText(language==='fr'?'Avis mixte — positif et négatif':'Đánh giá hỗn hợp — tích cực và tiêu cực')).toBeVisible()
 expect(panel).toHaveTextContent('1 / 5');expect(panel).toHaveTextContent(language==='fr'?'02/10/2026':'2/10/2026');expect(panel).not.toHaveTextContent('POSITIVE ONLY REVIEW')
 expect(document.body.style.position).toBe('fixed')
 fireEvent.click(within(panel).getByRole('button',{name:language==='fr'?'Fermer et revenir au rapport':'Đóng và quay lại báo cáo'}))
 expect(screen.queryByRole('dialog')).toBeNull();expect(trigger).toHaveFocus();expect(document.body.style.position).not.toBe('fixed');expect(window.scrollTo).toHaveBeenCalledWith(0,0)
 expect(JSON.stringify(row)).toBe(before);expect(deny).not.toHaveBeenCalled()
})
it('keeps zero counters inert and closes the panel with Escape/cancel',()=>{
 const row=parallelPresentationRow('fr');row.statistics!.counts.categories.ambiance.negative_including_mixed=0;row.statistics!.counts.categories.ambiance.negative_review_ids=[]
 const {container}=draw('fr',row),ambiance=container.querySelector('.v5-axis[data-axis="atmosphere"]')!
 expect(within(ambiance as HTMLElement).queryByRole('button')).toBeNull()
 fireEvent.click(within(container.querySelector('.v5-axis[data-axis="price"]') as HTMLElement).getByRole('button'))
 fireEvent(screen.getByRole('dialog'),new Event('cancel',{bubbles:false,cancelable:true}));expect(screen.queryByRole('dialog')).toBeNull()
})
it('reports missing IDs, missing source text, dates and ratings without fetching or fabricating data',()=>{
 const row=parallelPresentationRow('fr');row.source_reviews=row.source_reviews.filter(r=>r.id!=='review-never-selected');Object.assign(row.source_reviews[0],{original_text:'',analysis_text:null,rating:null,published_at:null})
 draw('fr',row);fireEvent.click(screen.getAllByRole('button',{name:'Avis négatifs, mixtes inclus : 2 — Service'})[0]);const panel=screen.getByRole('dialog')
 expect(panel).toHaveTextContent('1 avis classé(s) n’ont pas de source');expect(within(panel).getAllByText('Non disponible dans le corpus figé')).toHaveLength(3)
})
it('does not substitute evidence IDs when saved classification lists are missing or inconsistent',()=>{
 const row=parallelPresentationRow('fr');delete row.statistics!.counts.categories.service.positive_review_ids
 const data=experimentalNegativeReviews(row,'service');expect(data.available).toBe(false);expect(data.reviews).toEqual([])
 row.statistics!.counts.categories.service.positive_review_ids=[];row.statistics!.counts.categories.service.negative_including_mixed=3
 expect(experimentalNegativeReviews(row,'service').countMismatch).toBe(true);expect(row.statistics!.counts.categories.service.negative_including_mixed).toBe(3)
})
