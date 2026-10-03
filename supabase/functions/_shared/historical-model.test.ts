import {afterEach,describe,expect,it,vi} from 'vitest'
import {newHistoricalModel} from './historical-model.ts'
import {structuredCall} from './reputation-themes.ts'
import {extractConsultantBatch,consultantMetrics,consultantNarrative} from './consultant-report.ts'
import {AXES} from './consultant-contract.ts'

afterEach(()=>vi.unstubAllGlobals())
describe('historical model configuration only',()=>{
  it.each([['','gpt-6.1-sol'],['   ','gpt-6.1-sol'],[' gpt-6.1-sol ','gpt-6.1-sol'],['gpt-5.6-terra','gpt-5.6-terra']])('new run config %s resolves to %s',(env,expected)=>{
    vi.stubGlobal('Deno',{env:{get:()=>env}})
    expect(newHistoricalModel()).toBe(expected)
  })
  it('changes only the model in the actual extraction and narrative requests',async()=>{
    vi.stubGlobal('Deno',{env:{get:()=> 'test-key'}})
    const fetcher=vi.fn(async()=>Response.json({output_text:JSON.stringify({classifications:[],findings:[]}),usage:{input_tokens:17,output_tokens:11}}))
    vi.stubGlobal('fetch',fetcher)
    const reviews=[{id:'r1',rating:5,original_text:'Good food'}]
    await extractConsultantBatch(reviews,undefined,'gpt-5.6-terra')
    await extractConsultantBatch(reviews,undefined,'gpt-6.1-sol')
    const bodies=fetcher.mock.calls.map(call=>JSON.parse((call as unknown as [string,RequestInit])[1].body as string))
    expect(bodies[1]).toEqual({...bodies[0],model:'gpt-6.1-sol'})
    expect(bodies[1].reasoning).toEqual({effort:'low'})
    expect(bodies[1].max_output_tokens).toBe(10000)
    fetcher.mockImplementation(async()=>Response.json({output_text:JSON.stringify({axes:AXES.map(key=>({key})),explanations:[],conclusion:'Constat.'}),usage:{input_tokens:13,output_tokens:9}}))
    const metrics=consultantMetrics(reviews,[],[])
    await consultantNarrative(metrics,'fr',undefined,'gpt-5.6-terra')
    await consultantNarrative(metrics,'fr',undefined,'gpt-6.1-sol')
    const narratives=fetcher.mock.calls.slice(2).map(call=>JSON.parse((call as unknown as [string,RequestInit])[1].body as string))
    expect(narratives[1]).toEqual({...narratives[0],model:'gpt-6.1-sol'})
    expect(narratives[1].max_output_tokens).toBe(5500)
  })
  it('preserves usage and legacy callers without consulting model environment',async()=>{
    vi.stubGlobal('Deno',{env:{get:()=> 'gpt-6.1-sol'}})
    const fetcher=vi.fn(async()=>Response.json({output_text:'{}',usage:{input_tokens:17,output_tokens:11,total_tokens:28}}))
    vi.stubGlobal('fetch',fetcher)
    const usage=vi.fn()
    await structuredCall('unchanged',{}, {},500,usage)
    expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body as string).model).toBe('gpt-5.6-terra')
    expect(usage).toHaveBeenCalledWith({input_tokens:17,output_tokens:11})
  })
})
