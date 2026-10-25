// @vitest-environment node
import {afterEach,it,expect,vi} from 'vitest'
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text'
import {prepareHistoricalSnapshot,type HistoricalJob} from '../../supabase/functions/_shared/historical-report-worker'
import {currentReportProtocol} from '../../supabase/functions/_shared/current-report-v2'
import {currentBatchManifest} from '../../supabase/functions/_shared/current-batch-report'
import {rehearseParallel} from '../../supabase/functions/_shared/parallel-report-probe'
afterEach(()=>vi.restoreAllMocks())
it.each(['fr','vi'] as const)('freezes %s through snapshot, JEV batch and simulated compact Sol without English or provider access',async language=>{
 const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN')),original='English original: friendly staff.',sha=await analysisTextSha256(original)
 const org=crypto.randomUUID(),est=crypto.randomUUID(),rows=[{id:crypto.randomUUID(),rating:4,original_text:original,text:original,original_language:'en',published_at:'2020-01-01',review_reply_drafts:[],review_detailed_rating:{'Dịch vụ':5},review_translations:[{id:crypto.randomUUID(),language,translated_text:language==='fr'?'Personnel accueillant.':'Nhân viên thân thiện.',source_text_sha256:sha}]},{id:crypto.randomUUID(),rating:2,original_text:'',text:'',original_language:null,published_at:'2020-01-02',review_reply_drafts:[]}]
 const run={id:crypto.randomUUID(),generation_id:crypto.randomUUID(),request_id:crypto.randomUUID(),requested_by:crypto.randomUUID(),organization_id:org,establishment_id:est,engine:'jev_sol_v2',jev_transport:'batch_initial_v1',language,status:'running',created_at:new Date().toISOString(),snapshot:{analysis_version:8,analysis_text_policy:'account_google_or_original_v1',retention:{version:'latest_reviews_150_v1',review_count:2,review_ids:rows.map(r=>r.id),as_of:new Date().toISOString(),period_end:'2020-01-02'},retention_frozen_rows:rows.map(r=>({status:"new",historical_import:true,has_negative_feedback:false,review_context:null,review_detailed_rating:null,...r})),retention_establishment:{id:est,organization_id:org,name:'Offline only',rating:4,total_reviews:900,created_at:'2010-01-01'}}} as unknown as HistoricalJob
 const denyDB=new Proxy({},{get(){throw Error('DATABASE_FORBIDDEN')}})
 const prepared=await prepareHistoricalSnapshot(denyDB as never,run);run.snapshot=JSON.parse(JSON.stringify(prepared.snapshot))
 const p=await currentReportProtocol(run),m=await currentBatchManifest(p,s=>Math.ceil(s.length/3))
 expect(p.body.language).toBe(language);expect(p.body.source_snapshot.reviews[0].translation_provenance).toMatchObject({target_language:language,original_text_sha256:sha,provider:'google'})
 expect(p.body.denominators).toEqual({source_reviews:2,analytical_reviews:1,textless_statistics_only:1});expect(m.body.language).toBe(language);expect(m.body.plans).toHaveLength(1);expect(m.body.plans[0].reviews).toBe(1)
 expect(JSON.stringify(m.body.plans[0])).toContain(language==='fr'?'Personnel accueillant.':'Nhân viên thân thiện.');expect(JSON.stringify(m.body.plans[0])).not.toContain('English original:')
 expect(prepared.snapshot.base.customer_rating_statistics).toMatchObject({total_reviews:2,overall:{count:2,average:3},categories:{service:{count:1,average:5}}})
 const simulated=await rehearseParallel({...p,id:crypto.randomUUID()});expect(simulated).toMatchObject({provider_calls:0,mock_luna:0,mock_sol:1,status:'completed'});expect(network).not.toHaveBeenCalled()
},20000)
