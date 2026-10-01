import { webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reviewBatches } from '../_shared/reputation-metrics.ts'

const mocks=vi.hoisted(()=>({requireUser:vi.fn(),assertMembership:vi.fn(),extractThemes:vi.fn(),overallSummary:vi.fn()}))
vi.mock('../_shared/auth.ts',()=>({requireUser:mocks.requireUser,assertMembership:mocks.assertMembership}))
vi.mock('../_shared/reputation-themes.ts',async(importOriginal)=>({...await importOriginal<object>(),extractThemes:mocks.extractThemes,overallSummary:mocks.overallSummary}))

type Row=Record<string,unknown>
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks()})

describe('historical report resume integration with mocked database/AI',()=>{
  it.each([false,true])('preserves cursor=2 and processes only the next batch (zero findings=%s)',async(empty)=>{
    const reviews=Array.from({length:500},(_,index)=>({id:`review-${index}`,rating:5,original_text:'Good food',text:null,published_at:'2026-09-01T00:00:00Z',historical_import:true,has_negative_feedback:null,status:'new',review_detailed_rating:null,review_context:null,ready:false}))
    const digest=await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({reviews,language:'vi',googleTotal:1615,googleRating:4.8,version:2})))
    const source_fingerprint=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')
    const oldFinding={review_id:'review-0',theme_key:'food_quality',sentiment:'positive',evidence:'Good food'}
    let run:Row={id:'run-1',organization_id:'org-1',establishment_id:'est-1',language:'vi',generation_id:'generation-1',status:'failed',snapshot:{reviews,base:{source_fingerprint}},findings:[oldFinding],cursor:2,input_tokens:11436,output_tokens:17797,ai_calls:3,rejected_findings_count:0,token_usage_complete:false,updated_at:'2026-10-01T00:00:00Z'}
    const writes:{table:string;values:Row}[]=[]
    class Query {
      filters:Record<string,unknown>={};values:Row|null=null;offset=0
      constructor(readonly table:string){}
      select(){return this} eq(k:string,v:unknown){this.filters[k]=v;return this}
      lte(){return this} gte(){return this} order(){return this}
      range(start:number){this.offset=start;return this}
      update(values:Row){this.values=values;return this}
      insert(){throw new Error('MUST_NOT_CREATE_NEW_RUN')}
      upsert(){throw new Error('MUST_NOT_FINALIZE_EARLY')}
      execute(){
        if(this.values){
          writes.push({table:this.table,values:this.values})
          if(this.table!=='historical_report_runs')throw new Error('UNEXPECTED_WRITE')
          for(const [key,value] of Object.entries(this.filters))if(run[key]!==value)return {data:null,error:null}
          run={...run,...this.values}
        }
        const data=this.table==='establishments'?{id:'est-1',organization_id:'org-1',rating:4.8,total_reviews:1615,created_at:'2026-09-01T00:00:00Z'}
          :this.table==='profiles'?{preferred_language:'vi'}
          :this.table==='historical_establishment_reports'?null
          :this.table==='historical_report_runs'?structuredClone(run)
          :this.table==='reviews'?this.offset===0?reviews.map(r=>({...r,review_reply_drafts:[]})):[]:null
        return {data,error:null}
      }
      single(){return Promise.resolve(this.execute())} maybeSingle(){return this.single()}
      then(resolve:(value:ReturnType<Query['execute']>)=>unknown){return Promise.resolve(this.execute()).then(resolve)}
    }
    const database={from:(table:string)=>new Query(table),rpc:vi.fn(async(_name:string,args:Row)=>{
      run={...run,locked_by:args.p_worker_id,status:'running'};return {data:true,error:null}
    })}
    mocks.requireUser.mockResolvedValue({user:{id:'user'},client:database,admin:database})
    mocks.assertMembership.mockResolvedValue('owner')
    mocks.extractThemes.mockImplementation(async(batch,recordUsage)=>{
      expect(batch).toEqual(reviewBatches(reviews)[2])
      await recordUsage({input_tokens:500,output_tokens:700})
      return {findings:empty?[]:[{...oldFinding,review_id:batch[0].id}],rejectedCount:1,usage:{input_tokens:500,output_tokens:700}}
    })
    let handler:((request:Request)=>Promise<Response>)|undefined
    vi.stubGlobal('crypto',webcrypto)
    vi.stubGlobal('Deno',{serve:(fn:typeof handler)=>{handler=fn}})
    vi.resetModules()
    await import('./index.ts')
    const response=await handler!(new Request('https://example.test',{method:'POST',body:JSON.stringify({establishment_id:'est-1',force:true})}))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({pending:true,generation_id:'generation-1',progress:3})
    expect(mocks.extractThemes).toHaveBeenCalledTimes(1)
    expect(mocks.overallSummary).not.toHaveBeenCalled()
    expect(run).toMatchObject({generation_id:'generation-1',cursor:3,status:'running',ai_calls:4,input_tokens:11936,output_tokens:18497,rejected_findings_count:1,token_usage_complete:false})
    expect(run.findings).toEqual(empty?[oldFinding]:[oldFinding,{...oldFinding,review_id:'review-120'}])
    expect(writes.some(w=>w.values.cursor===0 || w.values.generation_id)).toBe(false)
  })
})
