import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../i18n'
import { buildDemoHistoricalReport } from '../lib/historical-report'
import { ReputationReport } from './ReputationReport'
import { summaryPreview } from '../lib/executive-summary'

vi.mock('../lib/supabase',()=>({supabase:null}))
afterEach(cleanup)
describe('full reputation report presentation',()=>{
  it.each(['fr','vi'] as const)('renders all sections in %s without fetching or generating AI',language=>{
    const report=buildDemoHistoricalReport('est',[],language,4.9,1659)
    Object.assign(report.reputation!,{sample_reviews_count:500,sample_average_rating:4.734,positive_rate:92,attention_reviews_count:40,food_average:4.728,food_review_count:453})
    const {container}=render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><I18nProvider language={language}><ReputationReport report={report}/></I18nProvider></MemoryRouter></QueryClientProvider>)
    expect(container.querySelectorAll('.weekly-kpi')).toHaveLength(4)
    expect(container.querySelectorAll('.reputation-category')).toHaveLength(3)
    expect(container.querySelectorAll('.historical-rating-row strong')[0]).toHaveTextContent('5★')
    expect(container.querySelectorAll('.historical-rating-row strong')[4]).toHaveTextContent('1★')
    expect(within(container.querySelector('.reputation-categories') as HTMLElement).getByText(language==='fr'?'453 évaluations sur 500 avis':'453 lượt chấm điểm trên 500 đánh giá')).toBeVisible()
    expect(screen.getByText(language==='fr'?'Gestion des réponses':'Quản lý phản hồi')).toBeVisible()
    expect(screen.getByText('92 %')).toBeVisible()
  })
})

describe('fixed executive template', () => {
  const fixture = (id: string) => {
    const report = buildDemoHistoricalReport(id, [], 'fr', 4.9, 1659)
    Object.assign(report.reputation!, {
      sample_reviews_count: 500, positive_rate: 92, sample_average_rating: 4.73,
      ai_overall_summary: 'Les clients apprécient les plats et le service. '.repeat(15),
      positive_themes: Array.from({length: 7}, (_, i) => ({theme_key: `positive-${i}`, category: 'food', sentiment: 'positive', label_fr: `Point fort ${i}`, label_vi: `Điểm mạnh ${i}`, mentions: 246 - i})),
      negative_themes: Array.from({length: 7}, (_, i) => ({theme_key: `negative-${i}`, category: 'service', sentiment: 'negative', label_fr: `Point à surveiller ${i}`, label_vi: `Cần lưu ý ${i}`, mentions: 30 - i})),
    })
    return report
  }
  const show = (report: ReturnType<typeof fixture>) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><I18nProvider language="fr"><ReputationReport report={report}/></I18nProvider></MemoryRouter></QueryClientProvider>)

  it.each(['Artisan Cafe & Eatery', 'Green Home Restaurant', 'Xóm Mới Garden'])('uses identical sections and limits for %s (frontend fixture)', name => {
    const {container} = show(fixture(name))
    expect([...container.querySelectorAll('.weekly-section-heading .eyebrow')].map(x => x.textContent)).toEqual(['01','02','03','04','05','06','07','08','09'])
    expect([...container.querySelectorAll('.weekly-section-heading h2')].map(x => x.textContent)).toEqual(['Vue d’ensemble','Répartition par étoiles','Synthèse exécutive','Cuisine · Service · Ambiance','Points forts','Points à surveiller','Avis positifs représentatifs','Avis à surveiller représentatifs','Gestion des réponses'])
    expect(container.querySelectorAll('.executive-positive li')).toHaveLength(4)
    expect(container.querySelectorAll('.executive-negative li')).toHaveLength(4)
    expect(container.querySelectorAll('.weekly-section')[4].querySelectorAll('li')).toHaveLength(5)
    expect(container.querySelectorAll('.weekly-section')[5].querySelectorAll('li')).toHaveLength(5)
    expect(screen.getByText('Satisfaction client très élevée')).toBeVisible()
  })

  it('expands source verbatim, collapses locally and keeps methodology closed initially', () => {
    const report = fixture('one')
    const before = JSON.stringify(report)
    const {container} = show(report)
    const detail = screen.getByRole('button', {name: 'Voir l’analyse détaillée'})
    const about = screen.getByRole('button', {name: 'À propos de cette analyse'})
    expect(detail).toHaveAttribute('aria-expanded', 'false')
    expect(about).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelector('.executive-text')!.textContent!.length).toBeLessThanOrEqual(451)
    fireEvent.click(detail)
    expect(container.querySelector('.executive-text')!.textContent).toBe(report.reputation!.ai_overall_summary)
    fireEvent.click(screen.getByRole('button', {name: 'Réduire'}))
    expect(detail).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(about)
    expect(document.getElementById(about.getAttribute('aria-controls')!)).toBeVisible()
    fireEvent.click(about)
    expect(document.getElementById(about.getAttribute('aria-controls')!)).not.toBeVisible()
    expect(JSON.stringify(report)).toBe(before)
  })

  it('retains all sections with explicit empty states', () => {
    const report = buildDemoHistoricalReport('empty', [], 'fr', 0, 0)
    report.reputation!.ai_overall_summary = null
    const {container} = show(report)
    expect(container.querySelectorAll('.weekly-section')).toHaveLength(9)
    expect(screen.getAllByText('Aucun point fort récurrent identifié dans les avis analysés')).toHaveLength(2)
    expect(screen.getAllByText('Aucun point récurrent nécessitant une attention particulière')).toHaveLength(2)
    expect(within(container.querySelector('.executive-summary') as HTMLElement).getByRole('button', {name:'Voir l’analyse détaillée'})).toBeDisabled()
    expect(screen.getAllByText('Aucun avis représentatif identifié.')).toHaveLength(2)
  })

  it.each([[90,'Satisfaction client très élevée'],[80,'Satisfaction client élevée'],[70,'Retours majoritairement positifs'],[69.9,'Retours plus partagés']] as const)('uses deterministic threshold %s', (rate, label) => {
    const report = fixture('threshold')
    report.reputation!.positive_rate = rate
    show(report)
    expect(screen.getByText(label)).toBeVisible()
  })

  it('does not rewrite short summaries', () => expect(summaryPreview('Un constat.')).toBe('Un constat.'))
  it('caps representative cards at three per sentiment without changing stored selection', () => {
    const report = fixture('examples')
    report.reputation!.representative_positive_review_ids = ['p1','p2','p3','p4']
    report.reputation!.representative_attention_review_ids = ['n1','n2','n3','n4']
    const ids = ['p1','p2','p3','n1','n2','n3']
    const client = new QueryClient()
    client.setQueryData(['reputation-examples',report.establishmentId,ids.join(',')], ids.map(id => ({id,rating:4,original_text:'Avis de test',text:null,author_name:'Auteur',published_at:null,review_translations:[]})))
    const {container} = render(<QueryClientProvider client={client}><MemoryRouter><I18nProvider language="fr"><ReputationReport report={report}/></I18nProvider></MemoryRouter></QueryClientProvider>)
    expect(container.querySelectorAll('.reputation-example')).toHaveLength(6)
    expect(report.reputation!.representative_positive_review_ids).toHaveLength(4)
    expect(report.reputation!.representative_attention_review_ids).toHaveLength(4)
  })
  it('moves explicit methodology out of the preview without rewriting conclusions', () => {
    expect(summaryPreview('L’analyse repose sur 500 avis. Les plats sont appréciés.')).toBe('Les plats sont appréciés.')
    expect(summaryPreview('Phân tích dựa trên 500 đánh giá. Khách hàng thích món ăn.')).toBe('Khách hàng thích món ăn.')
  })
})
