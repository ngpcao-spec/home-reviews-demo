import {cleanup,render,screen,within} from '@testing-library/react'
import {afterEach,describe,it,expect} from 'vitest'
import {GoogleReviewDetails} from './GoogleReviewDetails'
const ratings={'Đồ ăn':4,'Dịch vụ':1,'Bầu không khí':2}
const context={'Độ ồn':'Ồn ào, nhưng bạn vẫn trò chuyện được','Giá mỗi người':'700-800\u00a0N\u00a0₫','Loại hình bữa ăn':'Bữa tối','Quy mô nhóm':'Phù hợp với mọi quy mô nhóm'}
afterEach(cleanup)
describe('Google review metadata cards',()=>{
  it.each(['fr','vi'] as const)('renders all verified Xóm Mới metadata in %s without a summary',language=>{
    render(<GoogleReviewDetails ratings={ratings} context={context} language={language}/>)
    const scores=screen.getByRole('region',{name:language==='fr'?'Notes détaillées':'Điểm chi tiết'})
    for(const label of language==='fr'?['Qualité','Service','Ambiance']:['Đồ ăn','Dịch vụ','Không gian'])expect(within(scores).getByText(label)).toBeVisible()
    expect(within(scores).getAllByRole('definition').map(e=>e.textContent)).toEqual(['4 ★','1 ★','2 ★'])
    for(const label of language==='fr'?['Niveau de bruit','Prix par personne','Type de repas','Taille du groupe']:['Độ ồn','Giá mỗi người','Loại bữa ăn','Quy mô nhóm'])expect(screen.getByText(label)).toBeVisible()
    expect(screen.getByText('700–800 k₫')).toBeVisible()
    expect(screen.queryByText(/Résumé IA|Tóm tắt AI/)).not.toBeInTheDocument()
  })
  it('renders only a partial service score and noise field',()=>{
    render(<GoogleReviewDetails ratings={{service:3}} context={{'noise level':'Quiet, easy to talk'}} language="fr"/>)
    expect(screen.getByText('Service')).toBeVisible()
    expect(screen.getByText('Calme, conversation facile')).toBeVisible()
    expect(screen.queryByText('Qualité')).not.toBeInTheDocument()
    expect(screen.queryByText('Prix par personne')).not.toBeInTheDocument()
  })
  it('renders no empty cards',()=>{
    const {container}=render(<GoogleReviewDetails ratings={{}} context={null} language="vi"/>)
    expect(container).toBeEmptyDOMElement()
  })
  it('noise-only data does not create a scores card',()=>{
    render(<GoogleReviewDetails ratings={null} context={{'Độ ồn':'Custom observation'}} language="fr"/>)
    expect(screen.queryByRole('region',{name:'Notes détaillées'})).not.toBeInTheDocument()
    expect(screen.getByText('Custom observation')).toBeVisible()
  })
})
