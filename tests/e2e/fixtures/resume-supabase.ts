// Only aliased by vite.resume.config.ts. Never part of a production build.
import type { HistoricalRun } from '../../../src/lib/historical-generation'
type Listener = (event: string, session: { user: ReturnType<typeof user> } | null) => void
const listeners=new Set<Listener>()
const user=()=>({id:localStorage.getItem('resume-user') || 'account-a',email:'test@example.test',user_metadata:{}})
export const resumeHarness={queries:[] as string[],invocations:[] as string[],delay:0,fail:false,
  stepCalls:[] as Record<string,unknown>[], stepDelay:500, loseResponse:false,
  get run():HistoricalRun|null{return JSON.parse(localStorage.getItem('resume-run') ?? 'null')},
  set run(run:HistoricalRun|null){localStorage.setItem('resume-run',JSON.stringify(run))},
  emit(event:string,id?:string){if(id)localStorage.setItem('resume-user',id);listeners.forEach(fn=>fn(event,event==='SIGNED_OUT'?null:{user:user()}))},
}
const place=(id:string)=>({id:`place-${id}`,organization_id:`org-${id}`,name:id==='account-a'?'Artisan Cafe & Eatery':'Other account restaurant',
  address:'',google_maps_url:'https://maps.google.test',photo_url:null,rating:4.8,total_reviews:1615,active:true,last_sync_at:new Date().toISOString(),next_sync_at:null,sync_status:'ok'})
const report=(id:string)=>({id:`report-${id}`,organization_id:`org-${id}`,establishment_id:`place-${id}`,preferred_language:'vi',
  period_start:'2026-09-01T00:00:00Z',period_end:'2026-10-01T00:00:00Z',google_rating:4.8,google_total_reviews:1615,
  stored_reviews_count:500,negative_reviews_count:40,negative_rate:8,ready_replies_count:0,
  rating_1_count:11,rating_2_count:13,rating_3_count:16,rating_4_count:18,rating_5_count:442,
  data_complete:false,ai_historical_summary:'Cached historical summary',ai_status:'completed',ai_error:null,generated_at:'2026-10-01T01:00:00Z',
  analysis_version:2,sample_reviews_count:500,sample_average_rating:4.734,positive_rate:92,attention_reviews_count:40,
  processed_reviews_count:0,remaining_replies_count:40,food_average:4.73,food_review_count:453,service_average:4.85,service_review_count:452,
  atmosphere_average:4.9,atmosphere_review_count:451,positive_themes:[],negative_themes:[],representative_positive_review_ids:[],representative_attention_review_ids:[],
  ai_overall_summary:'Cached historical summary',source_undated_count:0,
})
class Query implements PromiseLike<{data: unknown;error:null}> {
  constructor(private table:string,private account:string){}
  select(){return this} eq(){return this} is(){return this} order(){return this} limit(){return this} range(){return this}
  maybeSingle(){return this} single(){return this} update(){return this}
  async result(){
    resumeHarness.queries.push(this.table)
    if(resumeHarness.delay)await new Promise(resolve=>setTimeout(resolve,resumeHarness.delay))
    if(resumeHarness.fail || localStorage.getItem('resume-offline')==='true' || !navigator.onLine)throw new Error('offline')
    const data=this.table==='establishments'?[place(this.account)]
      :this.table==='organizations'?[{id:`org-${this.account}`,monitoring_interval_hours:12}]
      :this.table==='profiles'?{preferred_language:'vi',notification_onboarding_seen:true,notification_permission_status:'denied'}
      :this.table==='historical_establishment_reports'?report(this.account):[]
    return {data,error:null}
  }
  then<TResult1={data:unknown;error:null},TResult2=never>(
    fulfilled?:((value:{data:unknown;error:null})=>TResult1|PromiseLike<TResult1>)|null,
    rejected?:((reason:unknown)=>TResult2|PromiseLike<TResult2>)|null,
  ){return this.result().then(fulfilled,rejected)}
}
export const isSupabaseConfigured=true
export const supabase={
  from:(table:string)=>new Query(table,user().id),
  auth:{
    getSession:async()=>({data:{session:{user:user()}}}),
    getUser:async()=>({data:{user:user()}}),
    onAuthStateChange:(listener:Listener)=>{listeners.add(listener);return{data:{subscription:{unsubscribe:()=>listeners.delete(listener)}}}},
    signOut:async()=>{resumeHarness.emit('SIGNED_OUT');return {error:null}},
  },
  channel:()=>({on(){return this},subscribe(){return this}}),removeChannel:async()=>undefined,
  functions:{invoke:async(name:string, options?:{body:Record<string,unknown>})=>{
    resumeHarness.invocations.push(name)
    if(name==='get-historical-report-status'){
      if(!navigator.onLine || localStorage.getItem('resume-offline')==='true')return{data:null,error:new Error('offline')}
      return{data:{run:resumeHarness.run},error:null}
    }
    if(name==='generate-historical-report' && resumeHarness.run?.status==='running'){
      resumeHarness.stepCalls.push(options?.body ?? {})
      const run=resumeHarness.run
      resumeHarness.run={...run,resumable:false}
      await new Promise(resolve=>setTimeout(resolve,resumeHarness.stepDelay))
      const progress=run.progress+1
      resumeHarness.run={...run,progress,status:progress>=5?'completed':'running',resumable:!resumeHarness.loseResponse}
      if(resumeHarness.loseResponse)return{data:null,error:new Error('CLIENT_REQUEST_INTERRUPTED')}
      return{data:progress>=5?{report:report(user().id)}:{pending:true,generation_id:run.generation_id,progress,total_steps:5},error:null}
    }
    return{data:null,error:new Error('NO_AI_ALLOWED_IN_RESUME_TEST')}
  }},
}
