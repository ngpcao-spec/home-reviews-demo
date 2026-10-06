// @vitest-environment node
import {describe,it,expect,vi} from 'vitest'
import {analysisTextForReview,groundingText,benchmarkText,analysisInputStats} from './analysis-text.ts'
import {translationLanguage} from './review-language.ts'
import {apifyActorInput,normalizeApifyReview} from './apify.ts'
import {matchedEnglishTranslations,englishCoverage,englishBackfillLimit,type EnglishReview} from './english-backfill.ts'
import {validateConsultantBatch,consultantBatches,extractConsultantBatch,consultantNarrative,consultantMetrics} from './consultant-report.ts'
import type {ReputationReview} from './reputation-metrics.ts'
import {newBenchmarkState,runJevBenchmark,type BenchmarkSource} from './jev-benchmark.ts'
import {readFileSync} from 'node:fs'
import {processHistoricalRun,type HistoricalJob} from './historical-report-worker.ts'
const ru={original_text:'Официант был грубым.',original_language:'ru',review_translations:[{language:'en',translated_text:'The waiter was rude.'},{language:'vi',translated_text:'Nhân viên thô lỗ.'}]}
const review:ReputationReview={id:'one',rating:1,...ru,...analysisTextForReview(ru),text:ru.original_text,published_at:null,historical_import:true,has_negative_feedback:null,status:'ignored',review_context:{Noise:'Quiet'},review_detailed_rating:null}
describe('English ingestion and immutable originals',()=>{
  it.each(['fr','vi'] as const)('A/B: preferred %s still creates an EN Apify input',language=>{expect(apifyActorInput({placeUrl:'https://www.google.com/maps?cid=123',language,sort:'newest',limit:150}).language).toBe('en')})
  it('C: original text including whitespace remains exact and provider language is independent',()=>{
    const item={reviewId:'id',stars:3,text:'  Русский текст.\n',textTranslated:'English version.',originalLanguage:'ru',translatedLanguage:'en-US'}
    const r=normalizeApifyReview(item)!;expect(r.text).toBe(item.text);expect(r.language).toBe('ru');expect(r.rawPayload).toEqual(item)
    const stored:EnglishReview={id:'uuid',external_review_id:'id',original_text:r.text,original_language:r.language??null,review_translations:[]}
    expect(matchedEnglishTranslations([stored],[r])[0]).toMatchObject({review_id:'uuid',language:'en',translated_text:'English version.'});expect(stored.original_text).toBe(item.text)
  })
  it.each(['en','en-US','en_GB','EN'])('normalizes %s only by actual returned language',language=>expect(translationLanguage(language)).toBe('en'))
  it('E/F/G: French is not mislabeled EN and old FR/VI translations stay intact',()=>{
    const stored:EnglishReview={id:'id',external_review_id:'external',...ru}
    const before=JSON.stringify(stored)
    expect(matchedEnglishTranslations([stored],[{externalReviewId:'external',translatedLanguage:'fr',translatedText:'Texte français'}])).toEqual([])
    expect(matchedEnglishTranslations([stored],[{externalReviewId:'external',translatedLanguage:'en_GB',translatedText:'English'}])[0].language).toBe('en')
    expect(JSON.stringify(stored)).toBe(before)
  })
  it('matching uses external id exclusively and ignores textless/original-English reviews',()=>{
    const stored:EnglishReview={id:'id',external_review_id:'expected',...ru}
    expect(matchedEnglishTranslations([stored],[{externalReviewId:'wrong',translatedLanguage:'en',translatedText:'English'}])).toEqual([])
    expect(matchedEnglishTranslations([{...stored,original_language:'en'}],[{externalReviewId:'expected',translatedLanguage:'en',translatedText:'English'}])).toEqual([])
    expect([0,101,501,2000].map(englishBackfillLimit)).toEqual([100,151,551,1000])
  })
})
describe('V7 analysis, grounding, diagnostics and benchmark',()=>{
  it('H/I/J: English translation, original EN, fallback and textless are distinct',()=>{
    expect(analysisTextForReview(ru)).toEqual({analysis_text:'The waiter was rude.',analysis_language:'en',analysis_source:'google_translation_en'})
    expect(analysisTextForReview({original_text:'Good',original_language:'en-US'})).toEqual({analysis_text:'Good',analysis_language:'en',analysis_source:'original_en'})
    expect(analysisTextForReview({...ru,review_translations:[]})).toMatchObject({analysis_text:ru.original_text,analysis_source:'fallback_original',analysis_language:'ru'})
    expect(analysisTextForReview({...ru,original_text:' '})).toMatchObject({analysis_text:'',analysis_source:'textless'})
  })
  it('input statistics expose non-English fallbacks without blocking',()=>{
    const values=[ru,{original_text:'Good',original_language:'en'}, {...ru,review_translations:[]},{original_text:'',original_language:'ru'}]
    expect(analysisInputStats(values)).toMatchObject({total_reviews:4,reviews_with_text:3,textless_reviews:1,original_english_count:1,google_english_translation_count:1,fallback_non_english_count:1,english_analysis_coverage_percent:2/3*100})
    expect(englishCoverage(values.map((r,i)=>({id:String(i),external_review_id:String(i),review_translations:[],...r})))).toMatchObject({stored_reviews:4,reviews_with_text:3,english_translation_missing:1})
  })
  it('K/L: V7 validates only analytical quotes, V6 only original quotes, individual failures are rejected',()=>{
    const raw={classifications:[{review_id:'one',sentiment:'negative',evidence:'rude'}],findings:[{review_id:'one',theme_key:'friendly_staff',sentiment:'negative',evidence:'rude'},{review_id:'one',theme_key:'noise',sentiment:'positive',evidence:'Quiet'},{review_id:'one',theme_key:'friendly_staff',sentiment:'negative',evidence:'грубым'}]}
    const v7=validateConsultantBatch(raw,[review],7),v6=validateConsultantBatch(raw,[review],6)
    expect(v7.findings.map(f=>f.evidence)).toEqual(['rude']);expect(v7.rejectedCount).toBe(2)
    expect(v6.findings.map(f=>f.evidence)).toEqual(['грубым']);expect(groundingText(review,6)).toBe(ru.original_text);expect(groundingText(review,7)).toBe('The waiter was rude.')
    expect(consultantBatches([review],7)).toHaveLength(1)
  })
  it('V7 extraction sends one analytical text and never duplicates Russian/context',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({output_text:JSON.stringify({classifications:[{review_id:'r0',sentiment:'negative',evidence:'rude'}],findings:[]}),usage:{input_tokens:1,output_tokens:1}}))))
    try {
      vi.stubGlobal('Deno',{env:{get:()=> 'fake'}})
      await extractConsultantBatch([review],undefined,'gpt-6.1-sol',7)
      const body=JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
      const serialized=JSON.stringify(body)
      expect(serialized).toContain('analysis_text');expect(serialized).toContain('The waiter was rude.');expect(serialized).not.toContain(ru.original_text);expect(serialized).not.toContain('Quiet')
    }finally{vi.unstubAllGlobals()}
  })
  it.each(['fr','vi'] as const)('N/O: V7 narrative still targets %s and uses manager report version 7',async language=>{
    const metrics=consultantMetrics([review],[{review_id:'one',basis:'text',sentiment:'negative',evidence:'rude'}],[{review_id:'one',theme_key:'friendly_staff',sentiment:'negative',evidence:'rude'}],7)
    vi.stubGlobal('Deno',{env:{get:()=> 'fake'}})
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({output_text:JSON.stringify({axes:[],explanations:[]}),usage:{input_tokens:1,output_tokens:1}})))
    vi.stubGlobal('fetch',fetcher)
    try{const result=await consultantNarrative(metrics,language,undefined,'gpt-6.1-sol',7,{});expect(result.report.version).toBe(7);expect(result.report.language).toBe(language);expect(JSON.stringify(JSON.parse(fetcher.mock.calls[0][1]!.body as string))).toContain(language==='fr'?'French':'Vietnamese')}finally{vi.unstubAllGlobals()}
  })
  it('V/W: benchmark helper and all Jev types select V7 analytical text, V6 original remains intact',async()=>{
    expect(benchmarkText(review,6)).toBe(ru.original_text);expect(benchmarkText(review,7)).toBe('The waiter was rude.')
    const s:BenchmarkSource={generation_id:'source',organization_id:'org',establishment_id:'place',status:'completed',model:'sol',snapshot:{analysis_version:7,reviews:[review]},classifications:[{review_id:'one',sentiment:'negative'}],findings:[],input_tokens:1,output_tokens:1,token_usage_complete:true,started_at:'2026-10-05T00:00:00Z',completed_at:'2026-10-05T00:01:00Z'}
    const state=newBenchmarkState(s,{repeat_count:1,concurrency:8,model:'jev-latest'})
    const fetcher=vi.fn<typeof fetch>(async url=>new Response(JSON.stringify(String(url).endsWith('/models')?{models:[{name:'jev-latest'}]}:{model:'jev',usage:{input_tokens:1,output_tokens:1},answers:{overall:{type:'choice',choice:'negative',confidence:1,probabilities:{positive:0,negative:1,insufficient:0}},...Object.fromEntries(['service','quality','price','atmosphere'].flatMap(a=>['positive','negative'].map(v=>[`${a}_${v}`,{type:'noul',noul:0}])))}})))
    await runJevBenchmark(s,{repeat_count:1,concurrency:8,model:'jev-latest'},'fake',state,{client:{fetcher}})
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string).state).toEqual({review_alias:'r01',analysis_text:'The waiter was rude.'})
  })
  it('P/Q: individual replies and four-star triage still use original fields',()=>{
    const code=readFileSync(new URL('../analyze-review/index.ts',import.meta.url),'utf8')
    expect(code).not.toContain('analysis_text');expect(code).toContain('original_text')
  })
  it('M: V7 preparation fingerprints analytical translations, while V6 ignores translation changes',async()=>{
    async function prepare(version:6|7,english:string){
      let checkpoint:Record<string,unknown>={}
      const data={...review,original_language:'ru',review_reply_drafts:[],review_translations:[{language:'en',translated_text:english}]}
      const admin={from(table:string){return {select(){return this},eq(){return this},lte(){return this},gte(){return this},order(){return this},single:async()=>({data:{id:'place',organization_id:'org',name:'Restaurant',rating:4,total_reviews:100,created_at:'2026-01-01T00:00:00Z'},error:null}),range:async()=>({data:table==='reviews'?[data]:[],error:null})}},rpc:async(_name:string,args:{p_values:Record<string,unknown>})=>{checkpoint=args.p_values;return {data:true,error:null}}}
      const run={id:'run',generation_id:'gen',establishment_id:'place',organization_id:'org',language:'vi',model:'gpt-6.1-sol',status:'running',snapshot:{analysis_version:version},cursor:0,created_at:'2026-10-05T00:00:00Z',attempt_count:0} as HistoricalJob
      await processHistoricalRun(admin as never,run,'worker')
      return checkpoint.snapshot as {reviews:ReputationReview[];base:{source_fingerprint:string;analysis_input_stats?:{english_analysis_coverage_percent:number}}}
    }
    const a=await prepare(7,'The waiter was rude.'),b=await prepare(7,'The waiter was polite.')
    expect(a.reviews[0]).toMatchObject({original_text:ru.original_text,original_language:'ru',analysis_text:'The waiter was rude.',analysis_source:'google_translation_en'})
    expect(a.base.analysis_input_stats?.english_analysis_coverage_percent).toBe(100);expect(a.base.source_fingerprint).not.toBe(b.base.source_fingerprint)
    const c=await prepare(6,'First'),d=await prepare(6,'Second');expect(c.base.source_fingerprint).toBe(d.base.source_fingerprint);expect(c.reviews[0]).not.toHaveProperty('analysis_text')
  })
})
