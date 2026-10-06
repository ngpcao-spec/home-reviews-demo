import {GOLD_SOURCE,GOLD_BENCHMARK,validateGoldSources,selectGoldReviews,replacementGoldReview,normalizeGoldLabels,compareGold,sha256,type GoldSource,type GoldBenchmark,type GoldReview,type GoldLabel} from './gold-core.ts'
import {GOLD_TAXONOMY,GOLD_RULES} from './gold-taxonomy.ts'
export interface GoldSet {id:string;organization_id:string;source_generation_id:string;jev_benchmark_id:string;name:string;status:'draft'|'completed';revision:number;target_reviews:number;taxonomy:typeof GOLD_TAXONOMY;taxonomy_version:string;methodology:string;source_fingerprint:string;benchmark_fingerprint:string;comparison:Awaited<ReturnType<typeof compareGold>>|null;created_at:string;completed_at:string|null}
export interface GoldRepository {user:string;loadSources:()=>Promise<{source:GoldSource;benchmark:GoldBenchmark}>;getSet:(id?:string)=>Promise<GoldSet|null>;reviews:(id:string)=>Promise<GoldReview[]>;labels:(id:string)=>Promise<GoldLabel[]>;create:(payload:Record<string,unknown>)=>Promise<string>;write:(id:string,revision:number,action:string,payload:Record<string,unknown>)=>Promise<void>}
export async function goldFingerprints(source:GoldSource,benchmark:GoldBenchmark){return {source_fingerprint:await sha256(JSON.stringify({reviews:source.snapshot.reviews.map(r=>({id:r.id,analysis_text:r.analysis_text,analysis_language:r.analysis_language})),findings:source.findings})),benchmark_fingerprint:await sha256(JSON.stringify({decisions:benchmark.decisions,repeat_count:benchmark.repeat_count,served_models:benchmark.served_models}))}}
export function blindGoldProjection(set:GoldSet,rows:GoldReview[],labels:GoldLabel[],source:GoldSource,annotation:boolean) {
  const active=rows.filter(r=>!r.excluded).sort((a,b)=>a.position-b.position)
  return {eligible:true,gold_set:{id:set.id,name:set.name,status:set.status,revision:set.revision,target_reviews:set.target_reviews,completed_reviews:active.filter(r=>r.confirmed_at).length,taxonomy_version:set.taxonomy_version,methodology:set.methodology,created_at:set.created_at,completed_at:set.completed_at},taxonomy:set.taxonomy,rules:GOLD_RULES,
    reviews:set.status==='draft'&&annotation?active.map(r=>({review_id:r.review_id,position:r.position,analysis_text:source.snapshot.reviews.find(s=>s.id===r.review_id)!.analysis_text,validated:!!r.confirmed_at,choices:r.confirmed_at?Object.fromEntries(labels.filter(l=>l.review_id===r.review_id).map(l=>[l.theme_key,l.choice])):null})):[],
    ...(set.status==='completed'?{comparison:set.comparison}:{})}
}
const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers})
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)
export function goldHandler(authenticate:(request:Request)=>Promise<GoldRepository>) {return async(request:Request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers})
  if(!['GET','POST'].includes(request.method))return json({error:'METHOD_NOT_ALLOWED'},405)
  try {
    const repo=await authenticate(request),params=new URL(request.url).searchParams,body=request.method==='POST'?await request.json():null
    const id=request.method==='POST'?body?.gold_set_id:params.get('gold_set_id')
    if(id&&!uuid(id))throw new Error('GOLD_ID_INVALID')
    let set=await repo.getSet(id??undefined)
    const {source,benchmark}=await repo.loadSources();validateGoldSources(source,benchmark)
    if(set&&set.organization_id!==source.organization_id)throw new Error('FORBIDDEN')
    const fingerprints=await goldFingerprints(source,benchmark)
    if(set&&(set.source_generation_id!==source.generation_id||set.jev_benchmark_id!==benchmark.id||set.source_fingerprint!==fingerprints.source_fingerprint||set.benchmark_fingerprint!==fingerprints.benchmark_fingerprint))throw new Error('GOLD_SOURCE_CHANGED')
    if(request.method==='POST') {
      if(body?.action==='create') {
        if(!set){const selected=await selectGoldReviews(source,benchmark);const created=await repo.create({p_user:repo.user,p_source:GOLD_SOURCE,p_benchmark:GOLD_BENCHMARK,p_reviews:selected,p_taxonomy:GOLD_TAXONOMY,p_source_fingerprint:fingerprints.source_fingerprint,p_benchmark_fingerprint:fingerprints.benchmark_fingerprint});set=await repo.getSet(created)}
      }else{
        if(!set)throw new Error('GOLD_NOT_FOUND');if(set.status!=='draft')throw new Error('GOLD_IMMUTABLE')
        if(!Number.isInteger(body?.revision)||body.revision!==set.revision)throw new Error('GOLD_REVISION_CHANGED')
        const rows=await repo.reviews(set.id),labels=await repo.labels(set.id)
        for(const row of rows){const text=source.snapshot.reviews.find(r=>r.id===row.review_id)?.analysis_text;if(text===undefined||await sha256(text)!==row.analysis_text_sha256)throw new Error('GOLD_TEXT_INTEGRITY_FAILED')}
        let payload:Record<string,unknown>
        if(body.action==='confirm_review') {
          if(!rows.some(r=>r.review_id===body.review_id&&!r.excluded)||!body.choices||typeof body.choices!=='object'||Array.isArray(body.choices))throw new Error('GOLD_CHOICES_INVALID')
          payload={review_id:body.review_id,choices:normalizeGoldLabels(body.choices)}
        }else if(body.action==='exclude_review')payload={review_id:body.review_id,replacement:await replacementGoldReview(source,benchmark,rows,body.review_id)}
        else if(body.action==='finalize'){
          if(body.confirm!==true||rows.filter(r=>!r.excluded&&r.confirmed_at).length!==40)throw new Error('GOLD_CONFIRMATION_REQUIRED')
          payload={comparison:await compareGold(set.id,source,benchmark,rows,labels)}
        }else throw new Error('GOLD_ACTION_INVALID')
        await repo.write(set.id,set.revision,body.action,payload);set=await repo.getSet(set.id)
      }
    }
    if(!set)return json({eligible:true,gold_set:null,taxonomy:GOLD_TAXONOMY,rules:GOLD_RULES,reviews:[]})
    const [rows,labels]=await Promise.all([repo.reviews(set.id),repo.labels(set.id)])
    for(const row of rows){const text=source.snapshot.reviews.find(r=>r.id===row.review_id)?.analysis_text;if(text===undefined||await sha256(text)!==row.analysis_text_sha256)throw new Error('GOLD_TEXT_INTEGRITY_FAILED')}
    return json(blindGoldProjection(set,rows,labels,source,request.method==='POST'||params.get('view')==='annotation'))
  }catch(error){const code=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'GOLD_REQUEST_FAILED';return json({error:code},code==='UNAUTHORIZED'?401:code==='FORBIDDEN'?403:code==='GOLD_NOT_FOUND'?404:['GOLD_IMMUTABLE','GOLD_REVISION_CHANGED','GOLD_SOURCE_CHANGED','GOLD_REPLACEMENT_UNAVAILABLE'].includes(code)?409:code.startsWith('GOLD_')?400:500)}
}}
