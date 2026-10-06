import { createJevClient, SIGNALS, type JevClientOptions, type JevDecision, type Choice } from './jev.ts'

export const JEV_BENCHMARK_CONCURRENCY = 8
export const JEV_INPUT_USD_PER_MILLION = 0.042
export const SOL_INPUT_USD_PER_MILLION = 2
export const SOL_OUTPUT_USD_PER_MILLION = 10
// Frozen V6 theme-to-axis projection. No imports from production AI modules.
export const V6_THEME_AXES: Record<string,string> = {
  food_quality:'quality',freshness:'quality',cooking:'quality',temperature:'quality',portions:'quality',presentation:'quality',drinks:'quality',variety:'quality',consistency:'quality',
  friendly_staff:'service',attentiveness:'service',wait_time:'service',coordination:'service',communication:'service',order_accuracy:'service',professionalism:'service',
  atmosphere:'atmosphere',decor:'atmosphere',noise:'atmosphere',comfort:'atmosphere',cleanliness:'atmosphere',location:'atmosphere',
  value:'price',billing:'price',price_level:'price',
}
export interface BenchmarkReview { id:string; original_text:string|null; rating:number }
export interface BenchmarkSource {
  generation_id:string; organization_id:string; establishment_id:string; status:string; model:string
  snapshot:{analysis_version?:number;reviews:BenchmarkReview[];base?:{analysis_version?:number;source_fingerprint?:string}}
  classifications:{review_id:string;sentiment:'positive'|'negative';basis?:string}[]
  findings:{review_id:string;theme_key?:string;axis?:string;sentiment:string}[]
  input_tokens:number; output_tokens:number; token_usage_complete:boolean; started_at:string; completed_at:string
}
export interface BenchmarkOptions { repeat_count:number; concurrency:number; model:string }
export interface CostRates { jev_input:number; sol_input:number; sol_output:number }
export interface ReviewDecisions<D=JevDecision> { review_id:string; repetitions:(D|null)[] }
export interface BenchmarkState<D=JevDecision> {
  decisions:ReviewDecisions<D>[]; served_models:string[]; request_count:number; retry_count:number
  jev_input_tokens:number; jev_output_tokens:number; jev_elapsed_ms:number
  request_durations_ms:number[]; evaluation_durations_ms:number[]
  errors:{review_alias:string;repeat:number;error_code:string}[]
}
export function validateOptions(body:Record<string,unknown>, defaultModel='jev-latest', defaultConcurrency=8):BenchmarkOptions {
  const repeat_count = body.repeat_count ?? 3, concurrency = body.concurrency ?? defaultConcurrency, model = body.model ?? defaultModel
  if (!Number.isInteger(repeat_count) || (repeat_count as number)<1 || (repeat_count as number)>5) throw new Error('INVALID_REPEAT_COUNT')
  if (!Number.isInteger(concurrency) || (concurrency as number)<1 || (concurrency as number)>8) throw new Error('INVALID_CONCURRENCY')
  if (typeof model!=='string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error('INVALID_JEV_MODEL')
  return {repeat_count:repeat_count as number,concurrency:concurrency as number,model}
}
export function validateSource(source:BenchmarkSource) {
  const version=source.snapshot?.analysis_version ?? source.snapshot?.base?.analysis_version
  if (source.status!=='completed' || version!==6 || (source.snapshot.base?.analysis_version!==undefined && source.snapshot.base.analysis_version!==6)) throw new Error('SOURCE_NOT_COMPLETED_V6')
  const reviews=source.snapshot.reviews
  if (!Array.isArray(reviews) || !reviews.length || reviews.length>500 || new Set(reviews.map(r=>r.id)).size!==reviews.length) throw new Error('SOURCE_INVALID_REVIEWS')
  if (reviews.some(r=>typeof r.id!=='string' || !(r.original_text===null || typeof r.original_text==='string') || !Number.isInteger(r.rating) || r.rating<1 || r.rating>5)) throw new Error('SOURCE_INVALID_REVIEWS')
  if (!Array.isArray(source.classifications) || !Array.isArray(source.findings)) throw new Error('SOURCE_INVALID_BASELINE')
  for (const review of reviews) {
    const labels=source.classifications.filter(c=>c.review_id===review.id)
    if (labels.length!==1 || !['positive','negative'].includes(labels[0].sentiment)) throw new Error('SOURCE_INVALID_BASELINE')
  }
  for (const finding of source.findings) if (!reviews.some(r=>r.id===finding.review_id) || !['positive','negative'].includes(finding.sentiment) || !(finding.axis ?? V6_THEME_AXES[finding.theme_key ?? ''])) throw new Error('SOURCE_INVALID_BASELINE')
  if (!Number.isSafeInteger(source.input_tokens) || !Number.isSafeInteger(source.output_tokens) || source.input_tokens<0 || source.output_tokens<0 || source.token_usage_complete!==true) throw new Error('SOURCE_USAGE_INCOMPLETE')
  if (!Number.isFinite(Date.parse(source.started_at)) || !Number.isFinite(Date.parse(source.completed_at)) || Date.parse(source.completed_at)<Date.parse(source.started_at)) throw new Error('SOURCE_INVALID_TIMESTAMPS')
}
export async function sourceFingerprint(source:BenchmarkSource) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({snapshot:source.snapshot,classifications:source.classifications,findings:source.findings,model:source.model,input_tokens:source.input_tokens,output_tokens:source.output_tokens,started_at:source.started_at,completed_at:source.completed_at})))
  return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('')
}
export function axisBaseline(source:BenchmarkSource) {
  const result=new Set<string>()
  for (const f of source.findings) result.add(`${f.review_id}:${f.axis ?? V6_THEME_AXES[f.theme_key ?? '']}_${f.sentiment}`)
  return result
}
const hasText=(r:BenchmarkReview)=>Boolean(r.original_text?.trim())
const fallback=(r:BenchmarkReview)=>r.rating>=4?'positive':'negative'
const rate=(n:number,d:number)=>d?n/d:null
const mean=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null
function distribution(values:number[]) {
  const sorted=[...values].sort((a,b)=>a-b)
  const quantile=(q:number)=>sorted.length?sorted[Math.max(0,Math.ceil(q*sorted.length)-1)]:null
  return {count:values.length,mean_ms:mean(values),p50_ms:quantile(.5),p95_ms:quantile(.95),max_ms:sorted.at(-1)??null}
}
export function compareBenchmark(source:BenchmarkSource, state:BenchmarkState, options:BenchmarkOptions, rates:CostRates) {
  const reviews=source.snapshot.reviews, textual=reviews.filter(hasText), baseline=new Map(source.classifications.map(c=>[c.review_id,c.sentiment])), axes=axisBaseline(source)
  const decisionMap=new Map(state.decisions.map(d=>[d.review_id,d.repetitions]))
  function overall(repeat:number, withFallback:boolean, allReviews:boolean) {
    let agreed=0,total=0
    const confusion:Record<string,Record<string,number>>={positive:{positive:0,negative:0,insufficient:0},negative:{positive:0,negative:0,insufficient:0}}
    const disagreements:{review_id:string;jev:Choice;sol:string}[]=[]
    for (const r of allReviews?reviews:textual) {
      const raw=decisionMap.get(r.id)?.[repeat]?.overall_choice
      if (hasText(r) && !raw) continue
      const choice=withFallback && (!hasText(r) || raw==='insufficient')?fallback(r):raw
      if (!choice) continue
      const sol=baseline.get(r.id)!
      total++; confusion[sol][choice]++
      if (choice===sol) agreed++; else disagreements.push({review_id:r.id,jev:choice,sol})
    }
    return {total_compared:total,agreements:agreed,agreement_with_sol_v6:rate(agreed,total),disagreement_count:disagreements.length,confusion_matrix:{rows:'Sol V6 reference',columns:'Jev decision',counts:confusion},disagreements}
  }
  const overallByRepeat=Array.from({length:options.repeat_count},(_,i)=>({repeat:i+1,raw_text_only:overall(i,false,false),v6_fallback_text_only:overall(i,true,false),v6_fallback_all_reviews:overall(i,true,true)}))
  const axisByThreshold=Object.fromEntries([.5,.7,.8].map(threshold=>[threshold.toFixed(2),Object.fromEntries(SIGNALS.map(signal=>{
    const per_repeat=Array.from({length:options.repeat_count},(_,repeat)=>{
      let tp=0,tn=0,fp=0,fn=0
      for (const r of textual) {
        const d=decisionMap.get(r.id)?.[repeat]
        if (!d) continue
        const prediction=d[`${signal}_probability`], reference=axes.has(`${r.id}:${signal}`)
        if (prediction>=threshold) { if(reference)tp++;else fp++ } else { if(reference)fn++;else tn++ }
      }
      return {repeat:repeat+1,total_compared:tp+tn+fp+fn,reference_positives:tp+fn,tp,tn,fp,fn,agreement_with_sol_v6:rate(tp+tn,tp+tn+fp+fn),precision_vs_sol_reference:rate(tp,tp+fp),recall_vs_sol_reference:rate(tp,tp+fn),f1_vs_sol_reference:rate(2*tp,2*tp+fp+fn)}
    })
    const tp=per_repeat.reduce((n,r)=>n+r.tp,0),tn=per_repeat.reduce((n,r)=>n+r.tn,0),fp=per_repeat.reduce((n,r)=>n+r.fp,0),fn=per_repeat.reduce((n,r)=>n+r.fn,0)
    return [signal,{per_repeat,pooled:{total_compared:tp+tn+fp+fn,tp,tn,fp,fn,agreement_with_sol_v6:rate(tp+tn,tp+tn+fp+fn),precision_vs_sol_reference:rate(tp,tp+fp),recall_vs_sol_reference:rate(tp,tp+fn),f1_vs_sol_reference:rate(2*tp,2*tp+fp+fn)}}]
  }))]))
  const complete=textual.filter(r=>decisionMap.get(r.id)?.filter(Boolean).length===options.repeat_count)
  const stable=complete.filter(r=>new Set(decisionMap.get(r.id)!.map(d=>d!.overall_choice)).size===1).length
  const probability_variation=Object.fromEntries(SIGNALS.map(signal=>{
    const per_review=complete.map(r=>{
      const values=decisionMap.get(r.id)!.map(d=>d![`${signal}_probability`])
      const min=Math.min(...values),max=Math.max(...values)
      return {review_id:r.id,mean_probability:mean(values),min_probability:min,max_probability:max,max_gap:max-min}
    })
    return [signal,{per_review,mean_probability:mean(per_review.map(r=>r.mean_probability!)),min_probability:per_review.length?Math.min(...per_review.map(r=>r.min_probability)):null,max_probability:per_review.length?Math.max(...per_review.map(r=>r.max_probability)):null,mean_probability_drift:mean(per_review.map(r=>r.max_gap)),max_probability_drift:per_review.length?Math.max(...per_review.map(r=>r.max_gap)):null}]
  }))
  const stable_decision_rate=options.repeat_count>1?rate(stable,complete.length):null
  const pooledRaw=overallByRepeat.reduce((a,r)=>({agreements:a.agreements+r.raw_text_only.agreements,total:a.total+r.raw_text_only.total_compared}),{agreements:0,total:0})
  const agreement=rate(pooledRaw.agreements,pooledRaw.total)
  const gaps=Object.values(probability_variation).flatMap(v=>v.per_review.map(r=>r.max_gap))
  return {
    scope:'decision-layer benchmark',reference:'Persisted Sol V6 results are a reference, not ground truth.',
    dataset:{source_generation_id:source.generation_id,source_analysis_version:6,reviews_total:reviews.length,reviews_with_text:textual.length,textless_review:reviews.length-textual.length,original_snapshot_order:true,source_snapshot_fingerprint:source.snapshot.base?.source_fingerprint??null},
    jev:{requested_model:options.model,served_models:state.served_models,multiple_served_models:state.served_models.length>1,repeat_count:options.repeat_count,concurrency:options.concurrency,request_count:state.request_count,retry_count:state.retry_count,input_tokens:state.jev_input_tokens,output_tokens:state.jev_output_tokens,estimated_jev_cost_usd:state.jev_input_tokens/1_000_000*rates.jev_input,rate_used:rates.jev_input,cost_label:'ESTIMATION AU TARIF CONFIGURÉ',elapsed_ms:state.jev_elapsed_ms,individual_http_requests:distribution(state.request_durations_ms),individual_evaluations_including_retries:distribution(state.evaluation_durations_ms),usage_note:'API-returned usage only; unsuccessful requests without usage cannot be metered here.'},
    sol_v6_baseline:{model:source.model,input_tokens:source.input_tokens,output_tokens:source.output_tokens,estimated_sol_baseline_cost_usd:(source.input_tokens*rates.sol_input+source.output_tokens*rates.sol_output)/1_000_000,rate_used:{input:rates.sol_input,output:rates.sol_output},cost_label:'ESTIMATION AU TARIF CONFIGURÉ',end_to_end_elapsed_ms:Date.parse(source.completed_at)-Date.parse(source.started_at),scope:'Full Sol run: extraction + narrative; elapsed includes worker/cron orchestration.'},
    overall_sentiment:{pooled_raw_agreement_with_sol_v6:agreement,by_repeat:overallByRepeat},axes_at_threshold:axisByThreshold,
    stability:{repeat_count:options.repeat_count,eligible_reviews:complete.length,missing_reviews:textual.length-complete.length,stable_reviews:options.repeat_count>1?stable:null,stable_decision_rate,probability_variation,mean_probability_drift:mean(gaps),max_probability_drift:gaps.length?Math.max(...gaps):null,note:options.repeat_count<2?'Not measured with a single repetition.':'Choice equality across all repetitions; drift is max minus min per review/signal.'},
    errors:state.errors,metrics_complete:state.errors.length===0 && complete.length===textual.length,
    verdict:{quality:agreement===null?'not_evaluable':agreement>=.95?'excellent':agreement>=.9?'prometteur':'insuffisant pour remplacement direct',stability:stable_decision_rate===null?'not_evaluable':stable_decision_rate>=.98?'excellente':stable_decision_rate>=.95?'bonne':'à investiguer',cost:'Decision-layer estimate only; potential savings require a full hybrid benchmark.',latency:'Sol V6 end-to-end elapsed vs Jev decision benchmark elapsed: different workloads.',next_step:'Manual evaluation of each axis, especially Price and Atmosphere; no automatic production switch.'},
  }
}
export function newBenchmarkState<D=JevDecision>(source:BenchmarkSource, options:BenchmarkOptions):BenchmarkState<D> {
  return {decisions:source.snapshot.reviews.map(r=>({review_id:r.id,repetitions:Array(options.repeat_count).fill(null)})),served_models:[],request_count:0,retry_count:0,jev_input_tokens:0,jev_output_tokens:0,jev_elapsed_ms:0,request_durations_ms:[],evaluation_durations_ms:[],errors:[]}
}
export async function runJevBenchmark<D=JevDecision>(source:BenchmarkSource, options:BenchmarkOptions, apiKey:string|undefined, state:BenchmarkState<D>, hooks:{client?:JevClientOptions;evaluate?:(client:ReturnType<typeof createJevClient>,model:string,alias:string,text:string)=>Promise<{decision:D}>;checkpoint?:(state:BenchmarkState<D>)=>Promise<void>;log?:(event:string,fields:Record<string,unknown>)=>void}={}) {
  const clientOptions=hooks.client??{}
  // Validate secret before touching source or state.
  createJevClient(apiKey,clientOptions)
  validateSource(source); validateOptions({...options})
  const start=Date.now(), indices=source.snapshot.reviews.map((r,i)=>hasText(r)?i:-1).filter(i=>i>=0)
  const log=hooks.log??(()=>{})
  const discovery=createJevClient(apiKey,clientOptions)
  await discovery.checkModel(options.model)
  for(let repeat=0;repeat<options.repeat_count;repeat++) {
    // Fixed snapshot order, fixed wave size, sequential repetitions.
    for(let offset=0;offset<indices.length;offset+=options.concurrency) {
      await Promise.all(indices.slice(offset,offset+options.concurrency).map(async index=>{
        const r=source.snapshot.reviews[index], alias='r'+String(index+1).padStart(2,'0'), requestStart=Date.now()
        const fields={review_alias:alias,repeat:repeat+1}
        const client=createJevClient(apiKey,{...clientOptions,
          onAttempt:event=>{state.request_count++;state.request_durations_ms.push(event.duration_ms);log('JEV_REQUEST_COMPLETED',{...fields,...event})},
          onRetry:event=>{state.retry_count++;log('JEV_REQUEST_RETRY',{...fields,...event,model:options.model})},
          onUsage:(usage,model)=>{state.jev_input_tokens+=usage.input_tokens;state.jev_output_tokens+=usage.output_tokens;if(!state.served_models.includes(model))state.served_models.push(model)},
        })
        try {
          const result=hooks.evaluate?await hooks.evaluate(client,options.model,alias,r.original_text!):await client.evaluate(options.model,alias,r.original_text!)
          state.decisions[index].repetitions[repeat]=result.decision as D
        } catch(error) {
          const error_code=error instanceof Error && /^JEV_[A-Z0-9_]+$/.test(error.message)?error.message:'JEV_REQUEST_FAILED'
          state.errors.push({...fields,error_code})
        } finally {state.evaluation_durations_ms.push(Date.now()-requestStart)}
      }))
      state.jev_elapsed_ms=Date.now()-start
      await hooks.checkpoint?.(state)
      // Terminal auth/schema failures stop subsequent waves; no further repetition.
      if(state.errors.some(e=>['JEV_HTTP_401','JEV_HTTP_403','JEV_HTTP_422','JEV_INVALID_RESPONSE','JEV_INVALID_USAGE'].includes(e.error_code)))throw new Error(state.errors.at(-1)!.error_code)
    }
  }
  state.jev_elapsed_ms=Date.now()-start
  return state
}
