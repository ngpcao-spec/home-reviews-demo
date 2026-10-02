import {describe,it,expect} from 'vitest'
import {googleSubratings,googleVisitInfo,visitValue} from './google-review-details'
export const xomRatings={'Đồ ăn':4,'Dịch vụ':1,'Bầu không khí':2}
export const xomContext={'Độ ồn':'Ồn ào, nhưng bạn vẫn trò chuyện được','Giá mỗi người':'700-800\u00a0N\u00a0₫','Loại hình bữa ăn':'Bữa tối','Quy mô nhóm':'Phù hợp với mọi quy mô nhóm'}
describe('Google metadata presentation, no inference',()=>{
  it('maps the verified Xóm Mới 2-star review subratings independently of the overall rating',()=>{
    expect(googleSubratings(xomRatings)).toEqual([{key:'food',value:4},{key:'service',value:1},{key:'atmosphere',value:2}])
    expect(googleVisitInfo(xomContext,'vi').map(v=>v.value)).toEqual(['Ồn ào, nhưng vẫn trò chuyện được','700–800 k₫','Bữa tối','Mọi quy mô nhóm'])
    expect(googleVisitInfo(xomContext,'fr').map(v=>v.value)).toEqual(['Bruyant, mais conversation possible','700–800 k₫','Dîner','Adapté à tous les groupes'])
  })
  it.each([null,{},[],false,'invalid'])('never fabricates missing data for %j',raw=>{
    expect(googleSubratings(raw)).toEqual([]);expect(googleVisitInfo(raw,'fr')).toEqual([])
  })
  it('accepts localized aliases and only the valid, present scores',()=>{
    expect(googleSubratings({Cuisine:'4 / 5',Service:3,Ambiance:0})).toEqual([{key:'food',value:4},{key:'service',value:3}])
    expect(googleSubratings({food:6,service:NaN,atmosphere:null})).toEqual([])
    expect(googleVisitInfo({'Taille de groupe':'2 personnes'},'vi')).toEqual([{key:'group_size',value:'2 personnes'}])
  })
  it('keeps unknown or ambiguous values without translating or changing amounts',()=>{
    expect(visitValue('noise','Description non standard','vi')).toBe('Description non standard')
    expect(visitValue('price_per_person','700-800 N','fr')).toBe('700-800 N')
    expect(visitValue('price_per_person','700.000 ₫','vi')).toBe('700.000 ₫')
    expect(googleVisitInfo({'Độ ồn':'','Giá mỗi người':{},'Quy mô nhóm':null},'vi')).toEqual([])
  })
})
