import {webcrypto} from 'node:crypto'
import {afterEach,describe,it,expect,vi} from 'vitest'
const mocks=vi.hoisted(()=>({database:null as unknown,requireUser:vi.fn(),sendPushToUser:vi.fn()}))
vi.mock('npm:@supabase/supabase-js@2.117.2',()=>({createClient:()=>mocks.database}))
vi.mock('../_shared/auth.ts',()=>({requireUser:mocks.requireUser}))
vi.mock('../_shared/push.ts',()=>({sendPushToUser:mocks.sendPushToUser}))
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks()})
type Row=Record<string,unknown>
async function setup({cached=false,automatic=false,rating=2,historical=true,duplicate=false}={}){
  let review:Row={id:'review',organization_id:'org',establishment_id:'place',rating,text:'Attente trop longue.',original_text:'Long wait.',language:'en',
    historical_import:historical,ai_summary:'OLD VALUE MUST REMAIN',ai_status:cached?'completed':null,ai_suggested_reply:cached?'Ancienne réponse.':null,
    ai_attempt_count:0,negative_feedback_checked_at:null,has_negative_feedback:null,review_context:{},review_detailed_rating:{}}
  let draft:Row|null=cached?{id:'draft',language:'fr',ai_summary:'OLD LOCALIZED SUMMARY',ai_suggested_reply:'Ancienne réponse.',draft_text:'Ancienne réponse.',draft_version:1,ai_status:'completed'}:null
  const writes:{table:string;value:Row}[]=[],selects:string[]=[]
  class Query{
    value:Row|null=null
    constructor(readonly table:string){}
    select(columns:string){selects.push(columns);return this} eq(){return this} neq(){return this} or(){return this}
    update(value:Row){this.value=value;return this} insert(value:Row){this.value=value;return this} upsert(value:Row){this.value=value;return this}
    result(){
      if(this.value){
        writes.push({table:this.table,value:this.value})
        if(this.table==='reviews')review={...review,...this.value}
        if(this.table==='review_reply_drafts')draft={id:'draft',draft_version:0,...draft,...this.value}
        if(this.table==='notifications')return duplicate?{data:null,error:{code:'23505'}}:{data:{id:'notification'},error:null}
      }
      const data=this.table==='reviews'?review:this.table==='review_reply_drafts'?draft:this.table==='profiles'?{preferred_language:'fr'}:
        this.table==='organizations'?{created_by:'user'}:this.table==='organization_members'?[{user_id:'user'}]:
        this.table==='establishments'?{name:'Restaurant'}:this.table==='ai_webhook_config'?{secret:'test-webhook-secret'}:null
      return {data,error:null}
    }
    single(){return Promise.resolve(this.result())} maybeSingle(){return this.single()}
    then(resolve:(v:ReturnType<Query['result']>)=>unknown){return this.single().then(resolve)}
  }
  const database={from:(table:string)=>new Query(table)}
  mocks.database=database;mocks.requireUser.mockResolvedValue({client:database,user:{id:'user'}})
  mocks.sendPushToUser.mockResolvedValue({sent:1,failed:0,skipped:false})
  const output=rating===4?{has_negative_feedback:true,negative_feedback_summary:'Attente longue.',ai_suggested_reply:'Merci pour votre retour.',detected_language:'en'}:
    {ai_suggested_reply:'Merci pour votre retour. Nous regrettons cette attente.',detected_language:'en'}
  const provider=vi.fn(async()=>new Response(JSON.stringify({output_text:JSON.stringify(output),usage:{input_tokens:100,output_tokens:30,total_tokens:130}}),{status:200}))
  vi.stubGlobal('fetch',provider);vi.stubGlobal('crypto',webcrypto)
  let handler!:(request:Request)=>Promise<Response>
  vi.stubGlobal('Deno',{env:{get:(name:string)=>name==='REVIEW_REPLY_MODEL'?undefined:'test-value'},serve:(fn:typeof handler)=>{handler=fn}})
  vi.resetModules();await import('./index.ts')
  return {provider,writes,selects,get review(){return review},get draft(){return draft},
    call:(regenerate=false)=>handler(new Request('https://example.test',{method:'POST',headers:automatic?{'x-home-reviews-webhook':'test-webhook-secret'}:{},body:JSON.stringify({review_id:'review',regenerate})}))}
}
describe('analyze-review reply-only persistence',()=>{
  it('explicit regeneration uses the short reply prompt once, while preserving legacy summary',async()=>{
    const h=await setup({cached:true})
    expect((await h.call(true)).status).toBe(200)
    expect(h.provider).toHaveBeenCalledTimes(1)
    const body=JSON.parse((h.provider.mock.calls[0] as unknown as [string,RequestInit])[1].body as string)
    expect(body.input[0].content).toContain('Do not summarize or restate the full review')
    expect(h.draft?.ai_summary).toBe('OLD LOCALIZED SUMMARY')
    expect(h.review.ai_model).toBe('gpt-6.1-sol')
    expect(h.draft?.draft_version).toBe(2)
  })
  it('generates one reply, records usage, never selects/writes/returns a summary and leaves legacy values untouched',async()=>{
    const h=await setup();const response=await h.call()
    expect(response.status).toBe(200)
    const payload=await response.json()
    expect(payload.ai_suggested_reply).toContain('Merci')
    expect(payload).not.toHaveProperty('ai_summary')
    expect(h.provider).toHaveBeenCalledTimes(1)
    expect(h.selects.join(',')).not.toContain('ai_summary')
    expect(JSON.stringify(h.writes)).not.toContain('ai_summary')
    expect(JSON.stringify(h.writes)).not.toContain('ai_last_rejected_summary')
    expect(h.review.ai_summary).toBe('OLD VALUE MUST REMAIN')
    expect(h.review).toMatchObject({ai_model:'gpt-6.1-sol',ai_input_tokens:100,ai_output_tokens:30,ai_total_tokens:130,ai_status:'completed'})
    expect(h.draft).toMatchObject({draft_version:1,ai_status:'completed',draft_text:payload.ai_suggested_reply})
    expect(mocks.sendPushToUser).not.toHaveBeenCalled()
  })
  it('reuses a completed old draft without regenerating because its summary was removed',async()=>{
    const h=await setup({cached:true});const payload=await (await h.call()).json()
    expect(payload).toMatchObject({reused:true,ai_suggested_reply:'Ancienne réponse.'})
    expect(payload).not.toHaveProperty('ai_summary')
    expect(h.provider).not.toHaveBeenCalled();expect(h.writes).toEqual([])
    expect(h.draft?.ai_summary).toBe('OLD LOCALIZED SUMMARY')
  })
  it('keeps four-star feedback but never copies it into ai_summary',async()=>{
    const h=await setup({rating:4});expect((await h.call()).status).toBe(200)
    expect(h.review).toMatchObject({has_negative_feedback:true,negative_feedback_summary:'Attente longue.'})
    expect(h.provider).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(h.writes)).not.toContain('ai_summary')
  })
  it('automatic historical imports still perform no AI or notification',async()=>{
    const h=await setup({automatic:true,historical:true})
    expect(await (await h.call()).json()).toMatchObject({skipped:true,reason:'HISTORICAL_IMPORT'})
    expect(h.provider).not.toHaveBeenCalled();expect(mocks.sendPushToUser).not.toHaveBeenCalled()
  })
  it.each([false,true])('notification rules remain intact, duplicate=%s; excerpt requires no extra model call',async duplicate=>{
    const h=await setup({automatic:true,historical:false,duplicate})
    expect((await h.call()).status).toBe(200)
    expect(h.provider).toHaveBeenCalledTimes(1)
    const notification=h.writes.find(w=>w.table==='notifications')!
    expect(notification.value).toMatchObject({type:'new_negative_review',review_id:'review',body:'Attente trop longue.'})
    expect(mocks.sendPushToUser).toHaveBeenCalledTimes(duplicate?0:1)
  })
})
