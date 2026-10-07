import {GOLD_KEYS,GOLD_TAXONOMY,GOLD_CHOICES,type GoldTheme,type GoldChoice} from './gold-taxonomy.ts'
export const GOLD_SOURCE='b73ec894-d5fd-4b11-9fe6-cd89c117e9de',GOLD_BENCHMARK='4c634678-17a9-47b3-89e1-fad0641f5d86'
export interface GoldSource {generation_id:string;organization_id:string;establishment_id:string;status:string;snapshot:{analysis_version:number;reviews:{id:string;analysis_text:string;analysis_language?:string}[]};findings:{review_id:string;theme_key:string;sentiment:string}[]}
type PredictionChoice=Exclude<GoldChoice,'uncertain'>
export interface GoldBenchmark {id:string;organization_id:string;establishment_id:string;source_generation_id:string;source_analysis_version:number;status:string;benchmark_type:string;repeat_count:number;served_models:string[];decisions:{review_id:string;repetitions:({themes:Record<string,{choice:PredictionChoice;probabilities:Record<PredictionChoice,number>}>}|null)[]}[]}
export interface GoldReview {gold_set_id?:string;review_id:string;position:number;analysis_text_sha256:string;selection_bucket:string;excluded:boolean;confirmed_at?:string|null}
export interface GoldLabel {review_id:string;theme_key:GoldTheme;choice:GoldChoice}
export async function sha256(text:string) {const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')}
export function validateGoldSources(source:GoldSource,jev:GoldBenchmark) {
  if(source.generation_id!==GOLD_SOURCE||jev.id!==GOLD_BENCHMARK||source.status!=='completed'||source.snapshot.analysis_version!==7||jev.status!=='completed'||jev.benchmark_type!=='themes_phase2'||jev.source_analysis_version!==7||jev.source_generation_id!==source.generation_id||jev.organization_id!==source.organization_id||jev.establishment_id!==source.establishment_id||jev.repeat_count!==3)throw new Error('GOLD_SOURCE_INVALID')
  const reviews=source.snapshot.reviews;if(!Array.isArray(reviews)||new Set(reviews.map(r=>r.id)).size!==reviews.length||reviews.filter(r=>r.analysis_text?.trim()).length<40||reviews.some(r=>typeof r.analysis_text!=='string'||(r.analysis_text.trim()&&r.analysis_language!=='en')))throw new Error('GOLD_ENGLISH_SOURCE_REQUIRED')
  for(const review of reviews.filter(r=>r.analysis_text.trim()))for(const key of GOLD_KEYS)averagedPresence(jev,review.id,key)
}
export function solChoice(source:GoldSource,id:string,key:GoldTheme):PredictionChoice {const labels=source.findings.filter(f=>f.review_id===id&&f.theme_key===key);const p=labels.some(f=>f.sentiment==='positive'),n=labels.some(f=>f.sentiment==='negative');return choiceFromPresence(p,n)}
export const choiceFromPresence=(p:boolean,n:boolean):PredictionChoice=>p?n?'both':'positive':n?'negative':'absent'
const presence=(choice:GoldChoice)=>({positive:choice==='positive'||choice==='both',negative:choice==='negative'||choice==='both'})
export function averagedPresence(jev:GoldBenchmark,id:string,key:GoldTheme) {
  const reps=jev.decisions.find(r=>r.review_id===id)?.repetitions
  if(!reps||reps.length!==3||reps.some(r=>!r?.themes[key]))throw new Error('GOLD_JEV_DECISIONS_INCOMPLETE')
  let p=0,n=0;const choices:string[]=[]
  for(const rep of reps){const a=rep!.themes[key],v=a.probabilities;if(!['absent','positive','negative','both'].includes(a.choice)||['absent','positive','negative','both'].some(k=>!Number.isFinite(v[k as PredictionChoice])||v[k as PredictionChoice]<0||v[k as PredictionChoice]>1)||Math.abs(Object.values(v).reduce((x,y)=>x+y,0)-1)>.01)throw new Error('GOLD_JEV_DECISIONS_INVALID');p+=v.positive+v.both;n+=v.negative+v.both;choices.push(a.choice)}
  return {positive:p/3,negative:n/3,stable:new Set(choices).size===1}
}
export const jevChoice=(jev:GoldBenchmark,id:string,key:GoldTheme,threshold=.5)=>{const p=averagedPresence(jev,id,key);return choiceFromPresence(p.positive>=threshold,p.negative>=threshold)}
export function normalizeGoldLabels(choices:Record<string,unknown>):Record<GoldTheme,GoldChoice> {if(Object.keys(choices).some(k=>!GOLD_KEYS.includes(k as GoldTheme))||Object.values(choices).some(v=>!GOLD_CHOICES.includes(v as GoldChoice)))throw new Error('GOLD_CHOICES_INVALID');return Object.fromEntries(GOLD_KEYS.map(k=>[k,choices[k]??'absent'])) as Record<GoldTheme,GoldChoice>}
export async function goldCandidates(source:GoldSource,jev:GoldBenchmark) {
  const priority=new Set(['attentiveness','professionalism','friendly_staff','wait_time'])
  return await Promise.all(source.snapshot.reviews.filter(r=>r.analysis_text.trim()).map(async r=>{
    const diffs=GOLD_KEYS.filter(k=>solChoice(source,r.id,k)!==jevChoice(jev,r.id,k)),negative=GOLD_KEYS.some(k=>presence(solChoice(source,r.id,k)).negative||presence(jevChoice(jev,r.id,k)).negative),unstable=GOLD_KEYS.some(k=>!averagedPresence(jev,r.id,k).stable)
    const tier=diffs.some(k=>priority.has(k))?0:diffs.some(k=>GOLD_TAXONOMY[k].axis==='service')?1:diffs.some(k=>GOLD_TAXONOMY[k].axis==='atmosphere')?2:diffs.length?3:negative||unstable?4:5
    return {review_id:r.id,analysis_text_sha256:await sha256(r.analysis_text),hash:await sha256(r.id),tier,negative,unstable,diffs:diffs.length,control:diffs.length<=2}
  }))
}
export async function selectGoldReviews(source:GoldSource,jev:GoldBenchmark):Promise<GoldReview[]> {
  const all=await goldCandidates(source,jev),controls=all.filter(r=>r.control).sort((a,b)=>a.hash.localeCompare(b.hash)).slice(0,8),used=new Set(controls.map(r=>r.review_id)),diagnostic=rankDiagnostic(all.filter(r=>!used.has(r.review_id))).slice(0,40-controls.length)
  if(controls.length+diagnostic.length!==40)throw new Error('GOLD_INSUFFICIENT_REVIEWS')
  return [...controls.map(r=>({...r,bucket:'control'})),...diagnostic.map(r=>({...r,bucket:'diagnostic'}))].sort((a,b)=>a.hash.localeCompare(b.hash)).map((r,i)=>({review_id:r.review_id,position:i+1,analysis_text_sha256:r.analysis_text_sha256,selection_bucket:r.bucket,excluded:false}))
}
function rankDiagnostic<T extends {tier:number;negative:boolean;unstable:boolean;diffs:number;hash:string}>(rows:T[]) {return [...rows].sort((a,b)=>a.tier-b.tier||Number(b.negative)-Number(a.negative)||Number(b.unstable)-Number(a.unstable)||b.diffs-a.diffs||a.hash.localeCompare(b.hash))}
export async function replacementGoldReview(source:GoldSource,jev:GoldBenchmark,rows:GoldReview[],excludedId:string) {
  const previous=rows.find(r=>r.review_id===excludedId&&!r.excluded);if(!previous)throw new Error('GOLD_REVIEW_NOT_ACTIVE')
  const used=new Set(rows.map(r=>r.review_id)),remaining=(await goldCandidates(source,jev)).filter(r=>!used.has(r.review_id)),control=previous.selection_bucket==='control'?remaining.filter(r=>r.control).sort((a,b)=>a.hash.localeCompare(b.hash))[0]:null
  const next=control??rankDiagnostic(remaining)[0];if(!next)throw new Error('GOLD_REPLACEMENT_UNAVAILABLE')
  return {review_id:next.review_id,position:previous.position,analysis_text_sha256:next.analysis_text_sha256,selection_bucket:control?'control':'diagnostic',excluded:false}
}
type Counts={tp:number;fp:number;fn:number;tn:number;support:number;uncertain:number}
const empty=():Counts=>({tp:0,fp:0,fn:0,tn:0,support:0,uncertain:0})
const sum=(rows:Counts[])=>rows.reduce((a,b)=>Object.fromEntries(Object.keys(a).map(k=>[k,a[k as keyof Counts]+b[k as keyof Counts]])) as Counts,empty())
const metrics=(c:Counts)=>({...c,precision:c.tp+c.fp?c.tp/(c.tp+c.fp):null,recall:c.tp+c.fn?c.tp/(c.tp+c.fn):null,f1:2*c.tp+c.fp+c.fn?2*c.tp/(2*c.tp+c.fp+c.fn):null})
export function modelScores(source:GoldSource,jev:GoldBenchmark,ids:string[],labels:Map<string,GoldChoice>,model:'sol'|'jev',threshold:number) {
  const perReview:Counts[]=[],themeCounts=Object.fromEntries(GOLD_KEYS.map(k=>[k,{positive:empty(),negative:empty()}])),exact={same:0,total:0}
  for(const id of ids){const row=empty();for(const theme of GOLD_KEYS){const gold=labels.get(id+':'+theme);if(!gold)throw new Error('GOLD_LABELS_INCOMPLETE');const prediction=model==='sol'?solChoice(source,id,theme):jevChoice(jev,id,theme,threshold);if(gold!=='uncertain'){exact.total++;if(prediction===gold)exact.same++}
    for(const polarity of ['positive','negative'] as const){const c=themeCounts[theme][polarity];if(gold==='uncertain'){c.uncertain++;continue}const g=presence(gold)[polarity],p=presence(prediction)[polarity],key=p?g?'tp':'fp':g?'fn':'tn';c[key]++;row[key]++;if(g){c.support++;row.support++}}}perReview.push(row)}
  const all=GOLD_KEYS.flatMap(k=>Object.values(themeCounts[k])),macro=all.filter(c=>c.support>=3).map(c=>metrics(c).f1).filter((v):v is number=>v!==null)
  return {micro_f1_gold:metrics(sum(all)).f1,macro_f1_gold:macro.length?macro.reduce((a,b)=>a+b,0)/macro.length:null,macro_supported_labels:macro.length,exact_choice_agreement_with_gold:exact.total?exact.same/exact.total:null,exact_choice_compared:exact.total,themes:Object.fromEntries(GOLD_KEYS.map(k=>[k,{positive:metrics(themeCounts[k].positive),negative:metrics(themeCounts[k].negative)}])),axes:Object.fromEntries(['service','quality','price','atmosphere'].map(axis=>[axis,metrics(sum(GOLD_KEYS.filter(k=>GOLD_TAXONOMY[k].axis===axis).flatMap(k=>Object.values(themeCounts[k]))))])),perReview}
}
export async function compareGold(id:string,source:GoldSource,jev:GoldBenchmark,rows:GoldReview[],goldLabels:GoldLabel[]) {
  const ids=rows.filter(r=>!r.excluded).sort((a,b)=>a.position-b.position).map(r=>r.review_id),labels=new Map(goldLabels.map(l=>[l.review_id+':'+l.theme_key,l.choice]));if(ids.length!==40||new Set(ids).size!==40)throw new Error('GOLD_INCOMPLETE')
  const sol=modelScores(source,jev,ids,labels,'sol',.5),je=modelScores(source,jev,ids,labels,'jev',.5),resolution={gold_matches_sol_only:0,gold_matches_jev_only:0,gold_matches_both:0,gold_matches_neither:0,gold_uncertain:0,total:0}
  let stable=0,pairs=0
  for(const review of ids)for(const theme of GOLD_KEYS){pairs++;if(averagedPresence(jev,review,theme).stable)stable++;const a=solChoice(source,review,theme),b=jevChoice(jev,review,theme),g=labels.get(review+':'+theme)!;if(a===b)continue;resolution.total++;if(g==='uncertain')resolution.gold_uncertain++;else if(g===a&&g===b)resolution.gold_matches_both++;else if(g===a)resolution.gold_matches_sol_only++;else if(g===b)resolution.gold_matches_jev_only++;else resolution.gold_matches_neither++}
  const seed=await sha256(id);let randomState=parseInt(seed.slice(0,8),16)||1;const random=()=>{randomState^=randomState<<13;randomState^=randomState>>>17;randomState^=randomState<<5;return (randomState>>>0)/4294967296}
  const distribution:number[]=[];let undefinedSamples=0
  for(let iteration=0;iteration<2000;iteration++){let atp=0,afp=0,afn=0,btp=0,bfp=0,bfn=0;for(let n=0;n<ids.length;n++){const index=Math.floor(random()*ids.length),a=sol.perReview[index],b=je.perReview[index];atp+=a.tp;afp+=a.fp;afn+=a.fn;btp+=b.tp;bfp+=b.fp;bfn+=b.fn}const ad=2*atp+afp+afn,bd=2*btp+bfp+bfn;if(!ad||!bd)undefinedSamples++;else distribution.push(2*btp/bd-2*atp/ad)}
  distribution.sort((a,b)=>a-b);const quantile=(p:number)=>distribution.length?distribution[Math.floor((distribution.length-1)*p)]:null,low=quantile(.025),high=quantile(.975)
  const {perReview:_sol,...solResult}=sol,{perReview:_jev,...jevResult}=je;void _sol;void _jev
  const verdict:'inconclusive'|'jev_better_on_diagnostic_gold'|'sol_better_on_diagnostic_gold'=low===null||high===null||undefinedSamples>0?'inconclusive':low>0?'jev_better_on_diagnostic_gold':high<0?'sol_better_on_diagnostic_gold':'inconclusive'
  return {methodology:'diagnostic_disagreement_v1',taxonomy_version:'gold-taxonomy-v1',reviews:ids.length,source_generation_id:source.generation_id,jev_benchmark_id:jev.id,served_models:jev.served_models,principal_threshold:.5,sol:solResult,jev:jevResult,jev_repeat_stability:stable/pairs,disagreement_resolution:resolution,
    bootstrap:{method:'review_level_paired_bootstrap',resamples:2000,seed_sha256:seed,valid_resamples:distribution.length,undefined_resamples:undefinedSamples,delta:sol.micro_f1_gold===null||je.micro_f1_gold===null?null:je.micro_f1_gold-sol.micro_f1_gold,ci_95_low:low,ci_95_high:high},
    verdict,
    exploratory:Object.fromEntries([.7,.8].map(t=>{const {perReview,...result}=modelScores(source,jev,ids,labels,'jev',t);void perReview;return [t.toFixed(2),{...result,exploratory:true}]})),
    sample_warning:'Diagnostic sample enriched for disagreements; does not estimate theme prevalence in all Google reviews.',uncertain_label_count:ids.reduce((n,id)=>n+GOLD_KEYS.filter(k=>labels.get(id+':'+k)==='uncertain').length,0),choice_resolution_note:'Both cannot occur for unequal exact Sol/Jev choices; this bucket is retained explicitly with zero count.'}
}
