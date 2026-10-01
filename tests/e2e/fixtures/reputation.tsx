// Synthetic frontend fixtures only; not included in the production entry point.
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../../../src/i18n'
import { ReputationReport } from '../../../src/components/ReputationReport'
import { buildDemoHistoricalReport } from '../../../src/lib/historical-report'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/reference.css'
import '../../../src/styles/warm-theme.css'

const params = new URLSearchParams(location.search)
const language = params.get('language') === 'vi' ? 'vi' : 'fr'
const name = params.get('name') ?? 'Artisan Cafe & Eatery'
const report = buildDemoHistoricalReport(name, [], language, 4.9, 1659)
Object.assign(report.reputation!, {
  sample_reviews_count: 500, positive_rate: 92, sample_average_rating: 4.73,
  ai_overall_summary: (language === 'vi' ? 'Khách hàng đánh giá cao chất lượng món ăn và thái độ phục vụ. Một số ý kiến đề cập đến thời gian chờ đợi. ' : 'Les clients apprécient la qualité des plats et l’accueil. Quelques avis mentionnent des délais de service. ').repeat(7),
  positive_themes: Array.from({length: 6}, (_, i) => ({theme_key: `positive-${i}`, category: 'food', sentiment: 'positive', label_fr: 'Qualité et saveur des plats préparés sur place', label_vi: 'Chất lượng và hương vị của các món ăn được chế biến tại chỗ', mentions: 246 - i})),
  negative_themes: Array.from({length: 6}, (_, i) => ({theme_key: `negative-${i}`, category: 'service', sentiment: 'negative', label_fr: 'Temps d’attente et coordination du service', label_vi: 'Thời gian chờ đợi và sự phối hợp trong phục vụ', mentions: 30 - i})),
})
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><I18nProvider language={language}><main style={{maxWidth: 1000, margin: 'auto', padding: 16}}><h1>{name}</h1><ReputationReport report={report}/></main></I18nProvider></MemoryRouter></QueryClientProvider>)
