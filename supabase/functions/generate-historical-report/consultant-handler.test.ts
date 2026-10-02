import { afterEach,describe,expect,it,vi } from 'vitest'
import { AXES } from '../_shared/consultant-contract.ts'
const mocks=vi.hoisted(()=>({requireUser:vi.fn(),assertMembership:vi.fn(),narrative:vi.fn(),extract:vi.fn()}))
vi.mock('../_shared/auth.ts',()=>({requireUser:mocks.requireUser,assertMembership:mocks.assertMembership}))
vi.mock('../_shared/consultant-report.ts',async original=>({...await original<object>(),consultantNarrative:mocks.narrative,extractConsultantBatch:mocks.extract}))
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks()})
type Row=Record<string,unknown>

async function setup(mode:'normal'|'missing'|'locked'|'forbidden'|'unauthorized'|'noText'|'failed'='normal'){
  const reviews=[{id:'r1',rating:5,original_text:mode==='noText'?'':'Slow service',text:null,review_context:null},{id:'r2',rating:2,original_text:'',text:null,review_context:null}]
  let run:Row={id:'run',generation_id:'generation',establishment_id:'est',organization_id:'org',language:'fr',attempt_count:1,status:'running',snapshot:{reviews,base:{establishment_id:'est',organization_id:'org',preferred_language:'fr',analysis_version:3,sample_reviews_count:2,negative_reviews_count:1,negative_rate:50}},cursor:mode==='noText'?0:1,
    classifications:mode==='missing'?[]:[{review_id:'r1',sentiment:mode==='noText'?'positive':'negative',basis:'text',evidence:'Slow service'},{review_id:'r2',sentiment:'negative',basis:'rating',evidence:''}],
    findings:mode==='noText'?[]:[{review_id:'r1',theme_key:'wait_time',sentiment:'negative',evidence:'Slow service'}],ai_calls:1,input_tokens:10,output_tokens:10,rejected_findings_count:0,token_usage_complete:true}
  const oldReport:Row={id:'old',generation_id:'old-generation',analysis_version:2,ai_status:'completed'}
  if(mode==='failed') run.status='failed'
  let report=oldReport
  const writes:{table:string;values:Row}[]=[]
  class Query{
    values:Row|null=null;filters:Row={};upserting=false
    constructor(readonly table:string){}
    select(){return this} eq(key:string,value:unknown){this.filters[key]=value;return this}
    update(values:Row){this.values=values;return this} upsert(values:Row){this.values=values;this.upserting=true;return this}
    execute(){
      if(this.values){
        writes.push({table:this.table,values:this.values})
        if(this.table==='historical_report_runs')run={...run,...this.values}
        else if(this.table==='historical_establishment_reports'&&this.upserting)report={...this.values,id:'report'}
        else throw new Error('UNEXPECTED_WRITE')
      }
      const data=this.table==='establishments'?{id:'est',organization_id:'org',name:'Private Establishment'}:this.table==='profiles'?{preferred_language:'fr'}:this.table==='historical_establishment_reports'?report:this.table==='historical_report_runs'?structuredClone(run):null
      return {data,error:null}
    }
    single(){return Promise.resolve(this.execute())} maybeSingle(){return this.single()}
    then(resolve:(value:ReturnType<Query['execute']>)=>unknown){return Promise.resolve(this.execute()).then(resolve)}
  }
  const database={from:vi.fn((table:string)=>new Query(table)),rpc:vi.fn(async(_name:string,args:Row)=>{if(mode==='locked')return {data:false,error:null};if(_name==='complete_historical_report_run'){report=args.p_report as Row;writes.push({table:'historical_establishment_reports',values:report});run={...run,status:'completed'}}else{run={...run,...args.p_values as Row};writes.push({table:'historical_report_runs',values:args.p_values as Row})}return {data:true,error:null}})}
  mocks.requireUser.mockImplementation(async()=>{if(mode==='unauthorized')throw new Error('UNAUTHORIZED');return {user:{id:'user'},client:database,admin:database}})
  mocks.assertMembership.mockImplementation(async()=>{if(mode==='forbidden')throw new Error('FORBIDDEN');return 'owner'})
  mocks.narrative.mockImplementation(async(metrics,language,recordUsage)=>{
    await recordUsage({input_tokens:20,output_tokens:30})
    return {report:{version:3,language,total:metrics.total,positive:metrics.positive,negative:metrics.negative,axes:AXES.map(key=>({key,positive:0,negative:key==='service'?1:0,summary:'Constat',recommendation:'Action'})),positive_aspects:[],negative_aspects:[],conclusion:'Synthèse'},usage:{input_tokens:20,output_tokens:30}}
  })
  const {processHistoricalRun}=await import('../_shared/historical-report-worker.ts')
  return {call:()=>processHistoricalRun(database as never,structuredClone(run) as never,'worker'),writes,database,getReport:()=>report,oldReport}

}
describe('V3 finalization and safety',()=>{
  it('does not restart a failed run through an automatic generation_id resume',async()=>{
    const harness=await setup('failed')
    expect((await harness.call()).status).toBe('failed')
    expect(harness.writes).toHaveLength(0)
    expect(mocks.extract).not.toHaveBeenCalled()
    expect(mocks.narrative).not.toHaveBeenCalled()
  })
  it('persists analytical counts separately and never writes operational reviews/notifications',async()=>{
    const harness=await setup()
    const response=await harness.call()
    expect(response.status).toBe('completed')
    expect(harness.getReport()).toMatchObject({analysis_version:3,analytical_positive_count:0,analytical_negative_count:2,negative_reviews_count:1,negative_rate:50,ai_call_count:2})
    expect(harness.writes.every(write=>['historical_report_runs','historical_establishment_reports'].includes(write.table))).toBe(true)
    expect(mocks.extract).not.toHaveBeenCalled()
  })
  it('repairs incomplete classifications and persists exact final counts plus fallback observability',async()=>{
    const harness=await setup('missing')
    const response=await harness.call()
    expect(response.status).toBe('completed')
    expect(harness.getReport()).toMatchObject({analytical_positive_count:1,analytical_negative_count:1,consultant_report:{total:2,positive:1,negative:1,classification_fallback_count:2}})
    const repaired=harness.writes.find(write=>Array.isArray(write.values.classifications))!
    expect(repaired.values.classifications).toHaveLength(2)
  })
  it('does not call AI when another request owns the lease',async()=>{
    const harness=await setup('locked')
    expect(await harness.call()).toMatchObject({status:'lease_lost'})
    expect(mocks.extract).not.toHaveBeenCalled()
    expect(mocks.narrative).not.toHaveBeenCalled()
  })
  it('classifies rating-only reviews without any AI call',async()=>{
    const harness=await setup('noText')
    expect((await harness.call()).status).toBe('completed')
    expect(harness.getReport()).toMatchObject({analytical_positive_count:1,analytical_negative_count:1})
    expect(mocks.narrative).not.toHaveBeenCalled()
  })
})
