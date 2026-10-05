import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { ConsultantReport } from './ConsultantReport'
import { axisSummaryText } from '../lib/report-presentation'
import { AXES, type ConsultantReportData } from '../../supabase/functions/_shared/consultant-contract'
import { mapHistoricalReport, type HistoricalReportRow } from '../lib/historical-report'
import { shabuReport } from '../../tests/fixtures/consultant-v5'

afterEach(cleanup)
describe('consultant report V5 diagnostic presentation',()=>{
  it.each(['fr','vi'] as const)('renders Google subratings and exact coverage without long aspect lists (%s)',language=>{
    const report=shabuReport(language),before=JSON.stringify(report)
    const {container}=render(<I18nProvider language={language}><ConsultantReport report={report}/></I18nProvider>)
    expect(container.querySelectorAll('.weekly-section')).toHaveLength(8)
    expect(container.querySelectorAll('.v5-quick-axis')).toHaveLength(4)
    expect(container.querySelectorAll('.v5-decisions>div')).toHaveLength(4)
    const price=container.querySelector('.v5-axis[data-axis="price"]')!
    expect(price).toHaveTextContent('13 %')
    expect(price.querySelector('.v5-score')).toBeNull()
    expect(container.querySelector('.v5-axis[data-axis="service"]')).toHaveTextContent('4,95')
    expect(container.querySelector('.v5-axis[data-axis="quality"]')).toHaveTextContent('4,91')
    expect(container.querySelector('.v5-axis[data-axis="atmosphere"]')).toHaveTextContent('4,90')
    expect(container.querySelector('.v5-axis[data-axis="atmosphere"] .v5-watch')).toHaveTextContent(language==='fr'?'À surveiller':'Cần theo dõi')
    expect(price).toHaveTextContent(language==='fr'?'Données limitées':'Dữ liệu còn hạn chế')
    expect(container.querySelector('.consultant-positive-details')).toBeNull()
    expect(container.querySelector('.consultant-negative')).toBeNull()
    for(const list of container.querySelectorAll('.v5-topics')) expect(list).toHaveTextContent(language==='fr'?'mentions':'lượt đề cập')
    expect(JSON.stringify(report)).toBe(before)
    const mapped=mapHistoricalReport({analysis_version:5,consultant_report:report} as HistoricalReportRow)
    expect(mapped.consultant).toBe(report)
  })
  it('keeps the legacy V4 renderer',()=>{
    const {container}=render(<I18nProvider language="fr"><ConsultantReport report={{...fixture('fr'),version:4}}/></I18nProvider>)
    expect(container.querySelectorAll('.weekly-section')).toHaveLength(9)
    expect(container.querySelector('.consultant-v5')).toBeNull()
  })
})
const fixture=(language:'fr'|'vi'):ConsultantReportData=>({version:3,language,total:5,positive:3,negative:2,
  axes:AXES.map(key=>({key,positive:1,negative:1,summary:language==='fr'?'Constats disponibles.':'Nhận xét hiện có.',recommendation:language==='fr'?'Action liée aux constats.':'Hành động dựa trên nhận xét.'})),
  positive_aspects:[{theme_key:'food_quality',axis:'quality',sentiment:'positive',label:language==='fr'?'Qualité':'Chất lượng',mentions:1,explanation:language==='fr'?'Appréciation ponctuelle.':'Ý kiến tích cực riêng lẻ.'}],negative_aspects:[],conclusion:language==='fr'?'Synthèse.':'Tổng hợp.'})
describe('consultant report V3',()=>{
  it.each(['fr','vi'] as const)('uses compact labels consistently for all axes (%s)',language=>{
    const report=fixture(language)
    const {container}=render(<I18nProvider language={language}><ConsultantReport report={report}/></I18nProvider>)
    const sections=container.querySelectorAll('.consultant-axis-section')
    expect(sections).toHaveLength(4)
    for(const section of sections){
      expect([...section.querySelectorAll('dt')].map(el=>el.textContent)).toEqual(language==='vi'?['Đánh giá tích cực','Đánh giá tiêu cực']:['Avis positifs','Avis négatifs'])
      expect([...section.querySelectorAll('dd')].map(el=>el.textContent)).toEqual(['1','1'])
      expect(section.querySelector('p')).toHaveAttribute('lang',language)
    }
  })
  it('only strips a redundant axis heading, preserving sentence meaning and stored data',()=>{
    expect(axisSummaryText('Dịch vụ : Khách hàng đánh giá cao sự thân thiện.','Dịch vụ')).toBe('Khách hàng đánh giá cao sự thân thiện.')
    expect(axisSummaryText('Qualité — Les plats sont appréciés.','Qualité')).toBe('Les plats sont appréciés.')
    expect(axisSummaryText('Dịch vụ được đánh giá cao.','Dịch vụ')).toBe('Dịch vụ được đánh giá cao.')
    expect(axisSummaryText('Les clients apprécient le service.','Service')).toBe('Les clients apprécient le service.')
  })
  it.each(['fr','vi'] as const)('renders nine fixed sections and four unchanged recommendations in %s',language=>{
    const {container}=render(<I18nProvider language={language}><ConsultantReport report={fixture(language)}/></I18nProvider>)
    expect([...container.querySelectorAll('.eyebrow')].map(element=>element.textContent)).toEqual(['01','02','03','04','05','06','07','08','09'])
    expect([...container.querySelectorAll('.weekly-section-heading h2')].map(element=>element.textContent)).toEqual(language==='fr'?['Vue d’ensemble','Synthèse de l’analyse','Service','Qualité','Prix','Ambiance','Points positifs','Points négatifs','Conclusion']:['Tổng quan','Tóm tắt phân tích','Dịch vụ','Chất lượng','Giá cả','Không gian','Điểm tích cực','Điểm tiêu cực','Kết luận'])
    expect(container.querySelectorAll('section')[8].querySelectorAll('li')).toHaveLength(4)
    expect(container.querySelectorAll('article > header.consultant-section-banner')).toHaveLength(9)
    expect(container.querySelectorAll('section > .weekly-section-heading')).toHaveLength(0)
    expect(container.querySelector('.consultant-count-list li')?.textContent).toMatch(/^- /)
    expect(container).not.toHaveTextContent('Google :')
  })
  it('uses stored values, sorts only summary copies, preserves all detailed aspects and never exposes audit fields',()=>{
    const report={...fixture('fr'),total:501,positive:458,negative:43,ai_calls:42,cursor:7,classification_fallback_count:92}
    report.positive_aspects=Array.from({length:7},(_,i)=>({...report.positive_aspects[0],theme_key:String(i),label:`Thème ${i}`,mentions:i+10,explanation:'Phrase redondante à ne pas afficher'}))
    report.negative_aspects=report.positive_aspects.map(item=>({...item,sentiment:'negative'}))
    const before=JSON.stringify(report)
    const {container}=render(<I18nProvider language="fr"><ConsultantReport report={report}/></I18nProvider>)
    const summary=container.querySelector('.consultant-synthesis')!
    expect(summary).toHaveTextContent('501')
    expect(summary).toHaveTextContent('458')
    expect(summary).toHaveTextContent('43')
    for(const list of summary.querySelectorAll('.consultant-count-list')) expect([...list.querySelectorAll('strong')].map(el=>el.textContent)).toEqual(['16','15','14','13','12'])
    expect(container.querySelectorAll('section')[6].querySelectorAll('li')).toHaveLength(7)
    expect(container.querySelectorAll('section')[7].querySelectorAll('li')).toHaveLength(7)
    expect(container).not.toHaveTextContent('Phrase redondante')
    expect(container).not.toHaveTextContent('classification_fallback_count')
    expect(container).not.toHaveTextContent('ai_calls')
    expect(JSON.stringify(report)).toBe(before)
  })
  it.each(['fr','vi'] as const)('keeps every section and four axes when data is missing (%s)',language=>{
    const report={...fixture(language),axes:[],positive_aspects:[],negative_aspects:[],conclusion:''}
    const {container}=render(<I18nProvider language={language}><ConsultantReport report={report}/></I18nProvider>)
    expect(container.querySelectorAll('section')).toHaveLength(9)
    expect(container.querySelectorAll('.consultant-axis-tile')).toHaveLength(4)
    expect(container.querySelector('.consultant-synthesis')).toHaveTextContent(language==='fr'?'Données insuffisantes':'Chưa đủ dữ liệu')
  })
  it('does not show a Vietnamese report in French',()=>{
    const {container}=render(<I18nProvider language="fr"><ConsultantReport report={fixture('vi')}/></I18nProvider>)
    expect(screen.getByRole('status')).toHaveTextContent('Ce rapport n’est pas disponible')
    expect(container.querySelectorAll('section')).toHaveLength(0)
  })
  it.each(['fr','vi'] as const)('shows counts without suffix in sections 07 and 08 (%s)',language=>{
    const report=fixture(language)
    report.negative_aspects=report.positive_aspects.map(item=>({...item,sentiment:'negative'}))
    const {container}=render(<I18nProvider language={language}><ConsultantReport report={report}/></I18nProvider>)
    expect(container.querySelector('.consultant-positive-details strong')).toHaveTextContent(/^1$/)
    expect(container.querySelectorAll('section')[7].querySelector('strong')).toHaveTextContent(/^1$/)
    expect(container.querySelector('.consultant-positive-details .eyebrow')).toHaveTextContent('07')
  })
  it.each([3,4,5,6] as const)('maps V%i separately from rating-based V2 data',version=>{
    const row={analysis_version:version,consultant_report:{...fixture('fr'),version},negative_reviews_count:4,negative_rate:80} as HistoricalReportRow
    const result=mapHistoricalReport(row)
    expect(result.consultant?.negative).toBe(2)
    expect(result.negativeReviewsCount).toBe(4)
    expect(result.reputation).toBeUndefined()
  })
})
