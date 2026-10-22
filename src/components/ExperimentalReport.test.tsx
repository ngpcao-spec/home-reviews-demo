import {afterEach,it,expect,vi} from 'vitest'
import {cleanup,render,screen,fireEvent,within} from '@testing-library/react'
import {I18nProvider} from '../i18n'
import {ExperimentalReport} from './ExperimentalReport'
import {ConsultantReport} from './ConsultantReport'
import {experimentalPresentation} from '../lib/experimental-report-presentation'
import {parallelPresentationRow} from '../../tests/fixtures/parallel-presentation'
import {shabuReport} from '../../tests/fixtures/consultant-v5'
afterEach(cleanup)
const draw=(language:'fr'|'vi',row=parallelPresentationRow(language))=>render(<I18nProvider language={language}><ExperimentalReport row={row} methodology="EXPLICIT TECHNICAL NOTE"/></I18nProvider>)
it.each(['fr','vi'] as const)('shares the current section order, headings, cards, axes and grids (%s)',language=>{
 const current=render(<I18nProvider language={language}><ConsultantReport report={shabuReport(language)}/></I18nProvider>)
 const headings=Array.from(current.container.querySelectorAll('.consultant-section-banner')).map(el=>el.textContent)
 current.unmount();const {container}=draw(language)
 expect(Array.from(container.querySelectorAll('.consultant-section-banner')).map(el=>el.textContent)).toEqual(headings)
 expect(container.querySelectorAll('.consultant-section-card')).toHaveLength(8)
 expect(container.querySelectorAll('.v5-quick-axis')).toHaveLength(4)
 expect(Array.from(container.querySelectorAll('.v5-axis')).map(el=>el.getAttribute('data-axis'))).toEqual(['service','quality','price','atmosphere'])
 expect(container.querySelector('.v5-axis[data-axis="service"]')).toHaveTextContent('EXPLICIT UNCHANGED ACTION')
})
it('uses stored mixed-inclusive native counts and their actual denominator, without substituting corpus size or Google scores',()=>{
 const row=parallelPresentationRow('fr'),a=experimentalPresentation(row).axis('service');expect(a).toMatchObject({positive:3,negative:2,mentioned:4,denominator:6,googleAverage:null})
 const {container}=draw('fr',row);const axis=container.querySelector('.v5-axis[data-axis="service"]')!
 expect(axis).toHaveTextContent('4 / 6');expect(axis).toHaveTextContent('66,67 %');expect(axis.querySelectorAll('dd')[0]).toHaveTextContent('3');expect(axis.querySelectorAll('dd')[1]).toHaveTextContent('2')
 expect(container.querySelector('.v5-score')).toBeNull();expect(container).not.toHaveTextContent('Couverture forte');expect(container).not.toHaveTextContent('seuil de récurrence')
})
it('leaves absent metrics absent, rather than converting them to zero',()=>{const row=parallelPresentationRow('fr');row.statistics=null;const {container}=draw('fr',row);expect(experimentalPresentation(row).axis('quality')).toMatchObject({positive:null,negative:null,denominator:null});expect(container.querySelector('.v5-axis')).toHaveTextContent('— / —');expect(container.querySelector('.v5-axis')).not.toHaveTextContent('0 %')})
it('only reuses genuine Google context from the matching frozen generation',()=>{
 const row=parallelPresentationRow('fr');row.source_report!.consultant_report=shabuReport('fr');row.source_report!.consultant_report.sample_average_rating=4.5
 expect(experimentalPresentation(row).reference?.sample_average_rating).toBe(4.5)
 row.reference_generation_id='DIFFERENT';expect(experimentalPresentation(row).reference).toBeNull()
})
it('preserves every stored narrative, observation, quotation, native statistic and audit value without any supplier access',()=>{
 const deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'))
 try{const row=parallelPresentationRow('vi'),before=JSON.stringify(row),{container}=draw('vi',row)
  for(const s of row.derived_report!.report.categories)expect(screen.getByText(s.text)).toBeVisible()
  for(const text of ['EXPLICIT POSITIVE PASSAGE','EXPLICIT NEGATIVE PASSAGE','EXPLICIT UNCHANGED CONCLUSION','EXPLICIT UNCHANGED OBSERVATION','EXPLICIT UNCHANGED ACTION','EXPLICIT UNCHANGED PRIORITY'])expect(screen.getByText(text)).toBeVisible()
  const audit=container.querySelector<HTMLDetailsElement>('.parallel-report-audit')!;expect(audit.open).toBe(false);expect(within(audit).getByText('EXPLICIT TECHNICAL NOTE')).not.toBeVisible()
  fireEvent.click(screen.getAllByRole('button',{name:'Xem đánh giá nguồn'})[0]);expect(audit.open).toBe(true)
  expect(within(audit).getAllByText('EXPLICIT SYNTHETIC CUSTOMER SOURCE.')[0]).toBeVisible()
  fireEvent.click(within(audit).getAllByText('Toàn bộ đánh giá và bản gốc')[0]);expect(within(audit).getAllByText('EXPLICIT ORIGINAL SYNTHETIC TEXT service')[0]).toBeVisible()
  expect(JSON.stringify(row)).toBe(before);expect(deny).not.toHaveBeenCalled()
 }finally{deny.mockRestore()}
})
it('does not unmask a section or alter its archived text to improve presentation',()=>{const row=parallelPresentationRow('fr');row.controls!.section_issues=[{path:'recommendations[0]',reason:'SYNTHETIC MISSING COVERAGE'}];const {container}=draw('fr',row);expect(screen.getByText('À réexaminer : couverture des preuves insuffisante.')).toBeVisible();expect(container.querySelector('.v5-axis[data-axis="service"]')).not.toHaveTextContent('EXPLICIT UNCHANGED ACTION');expect(container.querySelector('.parallel-report-audit')).toHaveTextContent('EXPLICIT UNCHANGED ACTION');expect(row.derived_report!.report.recommendations[0].proposed_action).toBe('EXPLICIT UNCHANGED ACTION')})
