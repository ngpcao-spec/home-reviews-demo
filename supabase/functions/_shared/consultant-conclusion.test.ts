import {afterEach,describe,it,expect,vi} from 'vitest'
import {managerConclusion,withManagerConclusion} from './consultant-conclusion.ts'
import {assembleConsultantReport,consultantNarrative,consultantMetrics} from './consultant-report.ts'
import {shabuReport} from '../../../tests/fixtures/consultant-v5'
import type {DecisionSummary,DiagnosticTopic} from './consultant-contract.ts'
const topic=(key:string):DiagnosticTopic=>({key:`${key}:negative`,axis:'atmosphere',sentiment:'negative',mentions:25,label:key})
const decision=():DecisionSummary=>shabuReport('vi',6).decision_summary!
const sentences=(s:string)=>s.split('.').filter(s=>s.trim())
afterEach(()=>vi.unstubAllGlobals())
describe('V6 manager conclusion only',()=>{
  it.each(['fr','vi'] as const)('uses three natural strengths and mentions limited price (%s)',language=>{
    const d=decision(),before=JSON.stringify(d)
    const text=managerConclusion(d,94,6,language)
    expect(sentences(text)).toHaveLength(3)
    expect(text).toContain(language==='fr'?'la qualité des plats, l’accueil et l’ambiance':'chất lượng món ăn, sự thân thiện trong phục vụ và bầu không khí')
    expect(text).toContain(language==='fr'?'limitées concernant les prix':'Riêng về giá cả')
    expect(text).not.toMatch(/threshold|coverage|finding|seuil de récurrence|ngưỡng lặp lại|\p{N}|%/iu)
    expect(JSON.stringify(d)).toBe(before)
    expect(managerConclusion(d,94,6,language)).toBe(text)
  })
  it.each(['fr','vi'] as const)('lists one or at most two selected priorities (%s)',language=>{
    const d={...decision(),strengths:decision().strengths.slice(0,2),limited_axes:[],manager_priorities:[topic('noise')]}
    const text=managerConclusion(d,94,6,language)
    expect(sentences(text)).toHaveLength(2)
    expect(text).toContain(language==='fr'?'le niveau sonore':'độ ồn')
    d.manager_priorities.push(topic('price_level'),topic('billing'))
    const second=sentences(managerConclusion(d,94,6,language))[1]
    expect(second).toContain(language==='fr'?'le niveau sonore et les prix':'độ ồn và mức giá')
    expect(second).not.toMatch(/facturation|hóa đơn/)
  })
  it.each(['fr','vi'] as const)('naturally lists multiple limited axes (%s)',language=>{
    const text=managerConclusion({...decision(),limited_axes:['price','service','quality']},94,6,language)
    expect(text).toContain(language==='fr'?'les prix, le service et la qualité des plats':'giá cả, dịch vụ và chất lượng món ăn')
    expect(sentences(text)).toHaveLength(3)
  })
  it.each([3,4,5] as const)('leaves V%i unchanged',version=>{
    const report={...shabuReport('fr'),version}
    expect(withManagerConclusion(report)).toBe(report)
  })
  it('changes only conclusion, preserving all V6 decisions, diagnostics and context',()=>{
    const report=shabuReport('vi',6),before=structuredClone(report)
    const updated=withManagerConclusion(report)
    expect(updated.conclusion).not.toBe(report.conclusion)
    expect({...updated,conclusion:report.conclusion}).toEqual(before)
    expect(report).toEqual(before)
  })
  it('covers empty, negative and mixed inputs without inventing strengths',()=>{
    const d={...decision(),strengths:[],manager_priorities:[]}
    expect(managerConclusion(d,0,0,'fr')).toContain('ne permettent pas encore')
    expect(managerConclusion(d,2,5,'fr')).toContain('plutôt négatifs')
    expect(managerConclusion(d,5,5,'vi')).toContain('trái chiều')
    expect(managerConclusion(d,2,5,'fr')).not.toContain('points forts')
  })
  it('integrates with both assembly paths, without an additional AI call',async()=>{
    const metrics=consultantMetrics([],[],[])
    const plain=assembleConsultantReport(metrics,{},'vi',6)
    expect(plain.conclusion).not.toContain('ngưỡng lặp lại')
    expect(assembleConsultantReport(metrics,{},'vi',5).conclusion).toContain('ngưỡng lặp lại')
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({output_text:JSON.stringify({axes:[],explanations:[]}),usage:{input_tokens:100,output_tokens:40}})))
    vi.stubGlobal('fetch',fetcher);vi.stubGlobal('Deno',{env:{get:()=> 'test-key'}})
    const result=await consultantNarrative(metrics,'vi',undefined,'gpt-6.1-sol',6)
    expect(result.report.conclusion).toBe(plain.conclusion)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
