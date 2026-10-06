import {analysisInputStats,type AnalysisReview} from './analysis-text.ts'
// Same 25-theme taxonomy as V6/V7, without importing an AI execution module.
const themeAxes=Object.fromEntries(Object.entries({service:['friendly_staff','attentiveness','wait_time','coordination','communication','order_accuracy','professionalism'],quality:['food_quality','freshness','cooking','temperature','portions','presentation','drinks','variety','consistency'],price:['value','billing','price_level'],atmosphere:['atmosphere','decor','noise','comfort','cleanliness','location']}).flatMap(([axis,themes])=>themes.map(theme=>[theme,axis])))

export interface ComparisonRun {
  generation_id:string;model:string;input_tokens:number;output_tokens:number;token_usage_complete?:boolean
  started_at:string|null;completed_at:string|null
  snapshot:{reviews?:({id:string}&AnalysisReview)[];base?:{analysis_input_stats?:unknown}}
  classifications:{review_id:string;sentiment:string}[]
  findings:{review_id:string;theme_key:string;sentiment:string;axis?:string}[]
}
export function runSummary(run:ComparisonRun,inputRate=2,outputRate=10) {
  const elapsed=run.started_at&&run.completed_at?Date.parse(run.completed_at)-Date.parse(run.started_at):null
  return {generation_id:run.generation_id,model:run.model,input_tokens:run.input_tokens,output_tokens:run.output_tokens,total_tokens:run.input_tokens+run.output_tokens,
    token_usage_complete:run.token_usage_complete??false,estimated_cost_usd:(run.input_tokens*inputRate+run.output_tokens*outputRate)/1_000_000,
    rate_used:{input_usd_per_million:inputRate,output_usd_per_million:outputRate},cost_label:'ESTIMATION_AT_CONFIGURED_RATE',elapsed_ms:elapsed,
    analysis_input_stats:analysisInputStats(run.snapshot.reviews??[])}
}
function counts(a:Set<string>,b:Set<string>) {const common=[...a].filter(x=>b.has(x)).length;return {v6:a.size,v7:b.size,common,v6_only:a.size-common,v7_only:b.size-common}}
const delta=(a:number,b:number)=>a?(b-a)/a*100:null
export function compareHistoricalRuns(v6:ComparisonRun,v7:ComparisonRun,inputRate=2,outputRate=10) {
  const a=new Set((v6.snapshot.reviews??[]).map(r=>r.id)),b=new Set((v7.snapshot.reviews??[]).map(r=>r.id)),common=new Set([...a].filter(id=>b.has(id)))
  const ca=new Map(v6.classifications.map(c=>[c.review_id,c.sentiment])),cb=new Map(v7.classifications.map(c=>[c.review_id,c.sentiment]))
  const compared=[...common].filter(id=>ca.has(id)&&cb.has(id)),differences=compared.filter(id=>ca.get(id)!==cb.get(id)).map(review_id=>({review_id,v6:ca.get(review_id),v7:cb.get(review_id)}))
  const findings=(run:ComparisonRun,filter:(f:ComparisonRun['findings'][number])=>boolean)=>new Set(run.findings.filter(f=>common.has(f.review_id)&&filter(f)).map(f=>JSON.stringify([f.review_id,f.theme_key,f.sentiment])))
  const match=(filter:(f:ComparisonRun['findings'][number])=>boolean)=>counts(findings(v6,filter),findings(v7,filter))
  const s6=runSummary(v6,inputRate,outputRate),s7=runSummary(v7,inputRate,outputRate)
  return {dataset:{...counts(a,b),identical:a.size===common.size&&b.size===common.size},sentiment:{compared:compared.length,missing_classification_count:common.size-compared.length,agreement_percent:compared.length?(compared.length-differences.length)/compared.length*100:null,difference_count:differences.length,differences},
    findings:{...match(()=>true),scope:'common_reviews',v6_all:v6.findings.length,v7_all:v7.findings.length},
    axes:Object.fromEntries(['service','quality','price','atmosphere'].map(axis=>[axis,match(f=>(f.axis??themeAxes[f.theme_key])===axis)])),
    service_themes:Object.fromEntries(['friendly_staff','attentiveness','professionalism','wait_time'].map(theme=>[theme,match(f=>f.theme_key===theme)])),
    v6:s6,v7:s7,cost_difference_percent:delta(s6.estimated_cost_usd,s7.estimated_cost_usd),tokens_difference_percent:delta(s6.total_tokens,s7.total_tokens),label:'V6/V7 agreement'}
}
