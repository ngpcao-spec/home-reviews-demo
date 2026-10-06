// @vitest-environment node
import {describe,it,expect,vi,afterEach} from 'vitest'
import {readFileSync} from 'node:fs'
import {compareLanguageEffect,languageVerdict,LANGUAGE_REFERENCE_ID,type LanguageReference} from './jev-language-effect'
import {themePayload,THEME_KEYS,type ThemeDecision} from './jev-themes'
import {benchmarkText} from './analysis-text'
import {newBenchmarkState,type BenchmarkSource} from './jev-benchmark'
import {compareThemes} from './jev-themes'
import {benchmarkHandler,type BenchmarkRepository} from './jev-benchmark-handler'
const options={repeat_count:3,concurrency:8,model:'jev-latest'},rates={jev_input:.042,sol_input:2,sol_output:10}
function fixture(){
  const reviews=Array.from({length:6},(_,i)=>({id:'r'+i,rating:5,original_text:'PRIVATE ORIGINAL RUSSIAN',original_language:'ru'}))
  const v6:BenchmarkSource={generation_id:'382c46aa-2505-44de-8693-71ab1fa92d11',organization_id:'org',establishment_id:'shabu',status:'completed',model:'gpt-6.1-sol',snapshot:{analysis_version:6,reviews:[...reviews,{id:'blank',rating:3,original_text:'',original_language:'ru'}]},classifications:[...reviews.map(r=>({review_id:r.id,sentiment:'positive' as const})),{review_id:'blank',sentiment:'negative'}],findings:reviews.slice(0,5).map(r=>({review_id:r.id,theme_key:'attentiveness',sentiment:'positive'})),input_tokens:100,output_tokens:100,token_usage_complete:true,started_at:'2026-10-05T00:00:00Z',completed_at:'2026-10-05T00:01:00Z'}
  const v7:BenchmarkSource={...structuredClone(v6),generation_id:'b73ec894-d5fd-4b11-9fe6-cd89c117e9de',snapshot:{analysis_version:7,reviews:v6.snapshot.reviews.map(r=>({...r,analysis_text:r.id==='blank'?'':'ENGLISH ANALYSIS ONLY',analysis_language:'en',analysis_source:r.id==='blank'?'textless':'google_translation_en'}))}}
  const state=newBenchmarkState<ThemeDecision>(v6,options)
  const answer={choice:'absent' as const,probabilities:{absent:1,positive:0,negative:0,both:0}}
  state.decisions.forEach((r,i)=>{if(i<6)r.repetitions=Array.from({length:3},()=>({themes:Object.fromEntries(THEME_KEYS.map(theme=>[theme,structuredClone(answer)])) as ThemeDecision['themes']}))})
  state.served_models=['jev-1.13.0'];state.jev_input_tokens=10000;state.jev_elapsed_ms=2000
  const comparison=compareThemes(v6,state,options,rates)
  const reference:LanguageReference={id:LANGUAGE_REFERENCE_ID,source_generation_id:v6.generation_id,source_analysis_version:6,benchmark_type:'themes_phase2',status:'completed',comparison,decisions:structuredClone(state.decisions)}
  return {v6,v7,state,reference}
}
afterEach(()=>vi.unstubAllGlobals())
describe('V7 Phase 2 English language experiment',()=>{
  it('uses English only, with exactly the same 25 Choice questions as V6',()=>{
    const {v6,v7}=fixture(),a=themePayload(options.model,'r0',benchmarkText(v6.snapshot.reviews[0],6)),b=themePayload(options.model,'r0',benchmarkText(v7.snapshot.reviews[0],7))
    expect(a.questions).toEqual(b.questions);expect(Object.keys(b.questions)).toHaveLength(25)
    expect(b.state).toEqual({review_alias:'r0',original_text:'ENGLISH ANALYSIS ONLY'});expect(JSON.stringify(b)).not.toContain('PRIVATE ORIGINAL RUSSIAN')
  })
  it('computes common IDs, joint support deltas, metrics, choices by matched repeat and no text copies',()=>{
    const {v6,v7,state,reference}=fixture(),before=JSON.stringify(reference)
    for(let i=0;i<5;i++)for(const rep of state.decisions[i].repetitions)rep!.themes.attentiveness={choice:'positive',probabilities:{absent:0,positive:1,negative:0,both:0}}
    state.served_models=['jev-new'];state.jev_input_tokens=20000;state.jev_elapsed_ms=1000
    const c=compareThemes(v7,state,options,rates),e=compareLanguageEffect(reference,v6,v7,c,state.decisions,true)!
    expect(e).toMatchObject({common_reviews:7,v6_only:0,v7_only:0,micro_f1_v6:0,micro_f1_v7:1,micro_f1_delta:1,macro_f1_delta:1,stability_delta:0})
    expect(e.axes.service.delta).toBe(1);expect(e.themes.attentiveness.positive.delta).toBe(1);expect(e.themes.friendly_staff.positive.delta).toBeNull()
    expect(e.choices.attentiveness).toMatchObject({same_choice_count:3,different_choice_count:15});expect(e.choices.attentiveness.choice_agreement_percent).toBeCloseTo(100/6)
    expect(e.review_level_diffs).toHaveLength(15);expect(e.served_models.different).toBe(true);expect(e.cost.cost_delta_percent).toBe(100);expect(e.latency.elapsed_delta_percent).toBe(-50)
    expect(JSON.stringify(e)).not.toMatch(/PRIVATE ORIGINAL|ENGLISH ANALYSIS|original_text|analysis_text/);expect(JSON.stringify(reference)).toBe(before)
  })
  it('requires completed Phase 2 V6, excludes 2B and counts different datasets',()=>{
    const {v6,v7,state,reference}=fixture(),c=compareThemes(v7,state,options,rates)
    expect(compareLanguageEffect(reference,v6,v7,c,state.decisions,false)).toBeNull()
    expect(()=>compareLanguageEffect({...reference,benchmark_type:'themes_phase2b_service'},v6,v7,c,state.decisions,true)).toThrow('SOURCE_LANGUAGE_REFERENCE_INVALID')
    v7.snapshot.reviews=v7.snapshot.reviews.slice(1);const result=compareLanguageEffect(reference,v6,v7,c,state.decisions,true)!
    expect(result).toMatchObject({common_reviews:6,v6_only:1,v7_only:0,datasets_identical:false})
  })
  it.each([[.06,'strong_improvement'],[.03,'moderate_improvement'],[.01,'neutral'],[-.02,'regression']] as const)('describes delta %s without a production switch', (delta,result)=>expect(languageVerdict(delta,[])).toBe(result))
  it('a weak documented axis prevents strong improvement',()=>expect(languageVerdict(.06,[{delta:-.06,sufficient_support:true}])).toBe('moderate_improvement'))
  it('manual V7 Phase 2 uses V7 findings, skips Phase 1 and excludes textless calls; unique insert blocks duplicates before Jev',async()=>{
    const {v6,v7,reference}=fixture(),tasks:Promise<void>[]=[],writes:Record<string,unknown>[]=[]
    v7.findings.push({review_id:'r5',theme_key:'attentiveness',sentiment:'positive'})
    const fetch=vi.fn(async(url:unknown,init?:RequestInit)=>{
      if(String(url).endsWith('/models'))return new Response(JSON.stringify({models:[{name:'jev-latest'}]}))
      const body=JSON.parse(init!.body as string);expect(body.state).toEqual({review_alias:expect.any(String),original_text:'ENGLISH ANALYSIS ONLY'});expect(body.questions).toEqual(themePayload(options.model,'r0','').questions)
      return new Response(JSON.stringify({model:'jev-1.13.0',usage:{input_tokens:100,output_tokens:10},answers:Object.fromEntries(THEME_KEYS.map(theme=>[theme,{type:'choice',choice:'absent',probabilities:{absent:1,positive:0,negative:0,both:0}}]))}))
    })
    vi.stubGlobal('fetch',fetch)
    const repo:BenchmarkRepository={authorize:vi.fn(),readSource:vi.fn(async()=>v7),readLatest:vi.fn(),readLanguageReference:vi.fn(async()=>({benchmark:reference,source:v6})),readBenchmark:vi.fn(),insertBenchmark:vi.fn(async()=>{}),updateBenchmark:vi.fn(async(_id,row)=>{writes.push(row)})}
    const handler=benchmarkHandler({authenticate:async()=>repo,env:key=>key==='TYPESAFE_API_KEY'?'mock-key':undefined,waitUntil:p=>tasks.push(p)})
    const post=()=>new Request('https://fixture.test',{method:'POST',body:JSON.stringify({source_generation_id:v7.generation_id,benchmark_type:'themes_phase2',...options})})
    expect((await handler(post())).status).toBe(202);await Promise.all(tasks)
    expect(repo.readLatest).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(19)
    const last=writes.at(-1)!;expect(last.status).toBe('completed');expect((last.comparison as ReturnType<typeof compareThemes>).theme_metrics['0.50'].attentiveness.positive.support_sol_v6).toBe(6)
    expect(last.comparison).toHaveProperty('language_effect.v6_benchmark_id',LANGUAGE_REFERENCE_ID);expect(JSON.stringify(last)).not.toContain('ENGLISH ANALYSIS ONLY')
    vi.mocked(repo.insertBenchmark).mockRejectedValue(new Error('BENCHMARK_ALREADY_RUNNING'));const before=fetch.mock.calls.length
    expect((await handler(post())).status).toBe(409);expect(fetch.mock.calls.length).toBe(before)
  })
  it('new comparison code has no OpenAI/backfill/write capability',()=>{
    const code=readFileSync(new URL('./jev-language-effect.ts',import.meta.url),'utf8')
    expect(code).not.toMatch(/fetch\(|\.update\(|\.insert\(|OpenAI|backfill-review|consultantNarrative|structuredCall/)
  })
})
