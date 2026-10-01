import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { ConsultantReport } from './ConsultantReport'
import { AXES, type ConsultantReportData } from '../../supabase/functions/_shared/consultant-contract'
import { mapHistoricalReport, type HistoricalReportRow } from '../lib/historical-report'

afterEach(cleanup)
const fixture=(language:'fr'|'vi'):ConsultantReportData=>({version:3,language,total:5,positive:3,negative:2,
  axes:AXES.map(key=>({key,positive:1,negative:1,summary:language==='fr'?'Constats disponibles.':'Nhận xét hiện có.',recommendation:language==='fr'?'Action liée aux constats.':'Hành động dựa trên nhận xét.'})),
  positive_aspects:[{theme_key:'food_quality',axis:'quality',sentiment:'positive',label:language==='fr'?'Qualité':'Chất lượng',mentions:1,explanation:language==='fr'?'Appréciation ponctuelle.':'Ý kiến tích cực riêng lẻ.'}],negative_aspects:[],conclusion:language==='fr'?'Synthèse.':'Tổng hợp.'})
describe('consultant report V3',()=>{
  it.each(['fr','vi'] as const)('renders exactly eight sections and four recommendations in %s',language=>{
    const {container}=render(<I18nProvider language={language}><ConsultantReport report={fixture(language)}/></I18nProvider>)
    expect([...container.querySelectorAll('.eyebrow')].map(element=>element.textContent)).toEqual(['01','02','03','04','05','06','07','08'])
    expect([...container.querySelectorAll('.weekly-section-heading h2')].map(element=>element.textContent)).toEqual(language==='fr'?['Synthèse des avis','Service','Qualité','Prix','Ambiance','Aspects positifs','Aspects négatifs','Conclusion']:['Tổng hợp đánh giá','Dịch vụ','Chất lượng','Giá cả','Không gian','Điểm tích cực','Điểm tiêu cực','Kết luận'])
    expect(container.querySelectorAll('section')[7].querySelectorAll('li')).toHaveLength(4)
    expect(container.querySelector('.consultant-aspects li')?.textContent).toMatch(/^- /)
    expect(container).not.toHaveTextContent('Google :')
  })
  it('does not show a Vietnamese report in French',()=>{
    const {container}=render(<I18nProvider language="fr"><ConsultantReport report={fixture('vi')}/></I18nProvider>)
    expect(screen.getByRole('status')).toHaveTextContent('Ce rapport n’est pas disponible')
    expect(container.querySelectorAll('section')).toHaveLength(0)
  })
  it('maps V3 separately from rating-based V2 data',()=>{
    const row={analysis_version:3,consultant_report:fixture('fr'),negative_reviews_count:4,negative_rate:80} as HistoricalReportRow
    const result=mapHistoricalReport(row)
    expect(result.consultant?.negative).toBe(2)
    expect(result.negativeReviewsCount).toBe(4)
    expect(result.reputation).toBeUndefined()
  })
})
