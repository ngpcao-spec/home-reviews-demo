import {afterEach,describe,it,expect,vi} from 'vitest'
import {assembleV5,consultantNarrativeV5} from './consultant-v5'
import {shabuTopics,shabuSource} from '../../../tests/fixtures/consultant-v5'
import {sentenceCount} from './consultant-priorities'
afterEach(()=>vi.unstubAllGlobals())
const input=()=>({total:100,positive:94,negative:6,topics:shabuTopics('fr'),source:shabuSource})
describe('V5 narrative contract',()=>{
  it('server owns summaries, status and conclusion even if model claims otherwise',()=>{
    const report=assembleV5(input(),'fr',{axes:[{key:'quality',summary:'Problème récurrent',supporting_keys:['food_quality:negative'],recommendation:'Changer la cuisine.'}],conclusion:'Ignorer le bruit.'})
    expect(report.version).toBe(5)
    expect(report.axes.find(a=>a.key==='quality')!.recommendation).not.toContain('Changer')
    expect(report.axis_diagnostics!.quality.status).toBe('major_strength')
    expect(report.conclusion).toContain('Niveau sonore')
    expect(sentenceCount(report.conclusion)).toBeLessThanOrEqual(3)
    expect(report.conclusion).not.toMatch(/\p{N}/u)
    expect(report.negative_aspects).toHaveLength(input().topics.filter(t=>t.sentiment==='negative').length)
    expect(report.axes).toHaveLength(4)
  })
  it('makes one narrative call, anonymizes IDs, pins Sol low and supplies authoritative diagnostics',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({output_text:JSON.stringify({axes:[],explanations:[]}),usage:{input_tokens:100,output_tokens:40}})))
    vi.stubGlobal('fetch',fetcher);vi.stubGlobal('Deno',{env:{get:()=> 'test-key'}})
    const result=await consultantNarrativeV5(input(),'fr',undefined,'gpt-6.1-sol')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const body=JSON.parse((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body as string)
    expect(body.model).toBe('gpt-6.1-sol');expect(body.reasoning).toEqual({effort:'low'})
    expect(JSON.stringify(body)).not.toContain('review_ids')
    expect(JSON.stringify(body)).toContain('axis_diagnostics')
    expect(result.usage).toEqual({input_tokens:100,output_tokens:40})
    expect(result.report.axis_diagnostics!.price.coverage_rate).toBe(.13)
  })
})
