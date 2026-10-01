import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../i18n'
import { buildDemoHistoricalReport } from '../lib/historical-report'
import { ReputationReport } from './ReputationReport'

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
    expect(screen.getByText(language==='fr'?'453 évaluations sur 500 avis':'453 lượt chấm điểm trên 500 đánh giá')).toBeVisible()
    expect(screen.getByText(language==='fr'?'Gestion des réponses':'Quản lý phản hồi')).toBeVisible()
    expect(screen.getByText('92 %')).toBeVisible()
  })
})
