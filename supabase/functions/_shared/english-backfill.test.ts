// @vitest-environment node
import {describe,it,expect,vi,afterEach} from 'vitest'
import {processEnglishJob,type EnglishJob,type EnglishReview} from './english-backfill.ts'
import {ApifyError} from './apify.ts'
import {readFileSync} from 'node:fs'
const provider=vi.hoisted(()=>({start:vi.fn(),poll:vi.fn(),dataset:vi.fn()}))
vi.mock('./apify.ts',async actual=>({...await actual<object>(),startApifyRun:provider.start,getApifyRun:provider.poll,fetchApifyDataset:provider.dataset}))
afterEach(()=>vi.resetAllMocks())
function harness(started=true){
  const reviews:EnglishReview[]=[{id:'review',external_review_id:'google-review',original_text:'Оригинал',original_language:'ru',review_translations:[{language:'fr',translated_text:'Français'},{language:'vi',translated_text:'Tiếng Việt'}]}]
  const writes:{table:string;values:Record<string,unknown>|Record<string,unknown>[]}[]=[]
  const admin={from(table:string){return {select(){return this},eq(){return this},order(){return this},range:async()=>({data:reviews,error:null}),single:async()=>({data:table==='establishments'?{google_maps_url:'https://maps.google.com?cid=1',google_id:'1'}:{id:'job'},error:null}),update(values:Record<string,unknown>){writes.push({table,values});return this},async upsert(values:Record<string,unknown>[]){writes.push({table,values});for(const row of values)reviews[0].review_translations.push({language:row.language as string,translated_text:row.translated_text as string});return {error:null}},then(resolve:(v:unknown)=>unknown){return Promise.resolve({error:null}).then(resolve)}}}}
  const job:EnglishJob={id:'job',organization_id:'org',establishment_id:'place',requested_by:'user',status:'running',targets:[{id:'review',external_review_id:'google-review'}],provider_limit:100,provider_requests:1,provider_run_id:started?'existing-run':null,provider_dataset_id:started?'existing-data':null,lease_token:'worker',deadline_at:new Date(Date.now()+60_000).toISOString()}
  return {admin,job,reviews,writes}
}
describe('Durable English-only backfill',()=>{
  it('completed provider matches id only and writes EN, preserving originals and FR/VI',async()=>{
    const h=harness(),original=h.reviews[0].original_text
    provider.poll.mockResolvedValue({runId:'existing-run',datasetId:'existing-data',status:'SUCCEEDED'})
    provider.dataset.mockImplementation(async(_token,_data,observe)=>{observe();return [{reviewId:'google-review',stars:2,text:'OTHER ORIGINAL',textTranslated:'English version',originalLanguage:'ru',translatedLanguage:'en_US'},{reviewId:'wrong-review',stars:2,textTranslated:'Wrong matching text',translatedLanguage:'en'}]})
    await processEnglishJob(h.admin as never,h.job,'fake')
    expect(h.writes.filter(w=>w.table==='review_translations')[0].values).toMatchObject([{review_id:'review',language:'en',translated_text:'English version'}])
    expect(h.reviews[0].original_text).toBe(original);expect(h.reviews[0].review_translations.map(t=>t.language)).toEqual(['fr','vi','en'])
    expect(h.writes.every(w=>['english_translation_backfill_jobs','review_translations'].includes(w.table))).toBe(true)
    expect(h.writes.at(-1)?.values).toMatchObject({status:'completed',result:{coverage_percent:100,provider_requests:3}})
    expect(provider.start).not.toHaveBeenCalled()
  })
  it('running Apify continues independently of the phone, without restarting a paid run',async()=>{
    const h=harness();provider.poll.mockResolvedValue({runId:'existing-run',datasetId:'existing-data',status:'RUNNING'})
    await processEnglishJob(h.admin as never,h.job,'fake');expect(h.writes.at(-1)?.values).toMatchObject({status:'running',lease_token:null,provider_requests:2});expect(provider.start).not.toHaveBeenCalled();expect(provider.dataset).not.toHaveBeenCalled()
  })
  it('transient polling error resumes the same run on the next worker tick',async()=>{
    const h=harness();provider.poll.mockRejectedValue(new ApifyError('APIFY_TIMEOUT',504))
    await processEnglishJob(h.admin as never,h.job,'fake');expect(h.writes.at(-1)?.values).toMatchObject({status:'running',error_code:'APIFY_TIMEOUT'});expect(provider.start).not.toHaveBeenCalled()
  })
  it('only a queued unstarted manual job creates a new EN newest run',async()=>{
    const h=harness(false);provider.start.mockResolvedValue({runId:'new',datasetId:'data',status:'RUNNING'})
    await processEnglishJob(h.admin as never,h.job,'fake');expect(provider.start).toHaveBeenCalledWith('fake',{placeUrl:'https://maps.google.com?cid=1',language:'en',sort:'newest',limit:100})
    expect(h.writes[0].values).toMatchObject({status:'starting'});expect(h.writes.at(-1)?.values).toMatchObject({status:'running',provider_run_id:'new'})
  })
  it('expired job makes no provider call; endpoint authorization precedes enqueue',async()=>{
    const h=harness();h.job.deadline_at='2000-01-01T00:00:00Z';await processEnglishJob(h.admin as never,h.job,'fake');expect(provider.poll).not.toHaveBeenCalled();expect(provider.start).not.toHaveBeenCalled()
    const endpoint=readFileSync(new URL('../backfill-review-english-translations/index.ts',import.meta.url),'utf8')
    expect(endpoint.indexOf('await assertMembership')).toBeLessThan(endpoint.indexOf('.insert('));expect(endpoint).not.toMatch(/structuredCall|analyze-review|enqueue_historical_report/)
  })
})
