import {GOLD_KEYS,GOLD_CHOICES,type GoldTheme,type GoldChoice} from './gold-taxonomy.ts'
import {GOLD_SOURCE,GOLD_BENCHMARK,sha256,solChoice,jevChoice,averagedPresence,validateGoldSources,type GoldSource,type GoldBenchmark,type GoldReview,type GoldLabel} from './gold-core.ts'
import {goldFingerprints,type GoldSet} from './gold-api.ts'
export const ADJUDICATION_GOLD_ID='1d5cfc8c-ac77-4e44-a7a7-6153eb132385'
export const ADJUDICATION_PRIORITY:GoldTheme[]=['attentiveness','professionalism','atmosphere','friendly_staff','coordination','communication','cooking',...GOLD_KEYS.filter(k=>!['attentiveness','professionalism','atmosphere','friendly_staff','coordination','communication','cooking'].includes(k))]
export const ADJUDICATION_WEIGHTS:Partial<Record<GoldTheme,number>>={attentiveness:5,professionalism:5,atmosphere:4,friendly_staff:3,coordination:3,communication:2}
export interface AdjudicationBundle {gold:GoldSet;source:GoldSource;benchmark:GoldBenchmark;goldReviews:GoldReview[];goldLabels:GoldLabel[]}
export interface AdjudicationItem {review_id:string;position:number;analysis_text_sha256:string;themes:GoldTheme[];confirmed_at?:string|null}
export interface AdjudicationLabel {review_id:string;theme_key:GoldTheme;choice:GoldChoice}
export async function validateAdjudicationBundle(b:AdjudicationBundle) {
  if(b.gold.id!==ADJUDICATION_GOLD_ID||b.gold.status!=='completed'||b.gold.taxonomy_version!=='gold-taxonomy-v1'||b.gold.source_generation_id!==GOLD_SOURCE||b.gold.jev_benchmark_id!==GOLD_BENCHMARK||b.gold.organization_id!==b.source.organization_id)throw new Error('ADJUDICATION_GOLD_REQUIRED')
  validateGoldSources(b.source,b.benchmark)
  const active=b.goldReviews.filter(r=>!r.excluded),labels=new Map(b.goldLabels.map(l=>[l.review_id+':'+l.theme_key,l.choice]))
  if(active.length!==40||new Set(active.map(r=>r.review_id)).size!==40||active.some(r=>GOLD_KEYS.some(k=>!GOLD_CHOICES.includes(labels.get(r.review_id+':'+k)!))))throw new Error('ADJUDICATION_GOLD_INCOMPLETE')
  for(const row of active){const text=b.source.snapshot.reviews.find(r=>r.id===row.review_id)?.analysis_text;if(!text?.trim()||await sha256(text)!==row.analysis_text_sha256)throw new Error('ADJUDICATION_TEXT_CHANGED')}
  const fp=await goldFingerprints(b.source,b.benchmark);if(fp.source_fingerprint!==b.gold.source_fingerprint||fp.benchmark_fingerprint!==b.gold.benchmark_fingerprint)throw new Error('ADJUDICATION_SOURCE_CHANGED')
}
export async function adjudicationFingerprint(b:AdjudicationBundle) {return sha256(JSON.stringify({gold:b.gold,reviews:[...b.goldReviews].sort((a,c)=>a.review_id.localeCompare(c.review_id)),labels:[...b.goldLabels].sort((a,c)=>a.review_id.localeCompare(c.review_id)||a.theme_key.localeCompare(c.theme_key)),source:await goldFingerprints(b.source,b.benchmark)}))}
export async function selectAdjudicationItems(b:AdjudicationBundle) {
  const labels=new Map(b.goldLabels.map(l=>[l.review_id+':'+l.theme_key,l.choice]))
  const candidates=await Promise.all(b.goldReviews.filter(r=>!r.excluded).map(async row=>{
    let score=0;const conflicts:GoldTheme[]=[]
    for(const theme of ADJUDICATION_PRIORITY){const g=labels.get(row.review_id+':'+theme)!,s=solChoice(b.source,row.review_id,theme),j=jevChoice(b.benchmark,row.review_id,theme)
      if(g===s&&g===j)continue;conflicts.push(theme);score+=(ADJUDICATION_WEIGHTS[theme]??1)+(s!==j?2:0)+(Number(g===s)+Number(g===j)===1?2:0)+(!averagedPresence(b.benchmark,row.review_id,theme).stable?1:0)
    }
    return {row,score,themes:conflicts.slice(0,3),hash:await sha256(row.review_id)}
  }))
  const ranked=candidates.filter(c=>c.themes.length).sort((a,c)=>c.score-a.score||a.hash.localeCompare(c.hash))
  if(ranked.length<12)throw new Error('ADJUDICATION_INSUFFICIENT_CONFLICTS')
  // Deterministic augmenting-path allocation protects diversity when pools overlap.
  const slots=['attentiveness','attentiveness','attentiveness','professionalism','professionalism','professionalism','atmosphere','atmosphere','other','other','other','other']
  const owner=new Map<number,number>(),assigned=new Map<number,number>()
  const eligible=(index:number,slot:number)=>slots[slot]==='other'?ranked[index].themes.some(k=>!['attentiveness','professionalism','atmosphere'].includes(k)):ranked[index].themes.includes(slots[slot] as GoldTheme)
  function allocate(slot:number,seen:Set<number>):boolean{for(let i=0;i<ranked.length;i++){if(seen.has(i)||!eligible(i,slot))continue;seen.add(i);const previous=owner.get(i);if(previous===undefined||allocate(previous,seen)){owner.set(i,slot);assigned.set(slot,i);return true}}return false}
  slots.forEach((_,slot)=>allocate(slot,new Set()))
  const chosen=new Set(assigned.values());for(let i=0;chosen.size<12;i++)chosen.add(i)
  const selected=[...chosen].map(i=>ranked[i]).sort((a,c)=>c.score-a.score||a.hash.localeCompare(c.hash))
  return {items:selected.map((c,i)=>({review_id:c.row.review_id,position:i+1,analysis_text_sha256:c.row.analysis_text_sha256,themes:c.themes})),selection:{methodology:'human_final_adjudication_v1',weights:ADJUDICATION_WEIGHTS,bonuses:{sol_jev_disagreement:2,gold_matches_one:2,jev_unstable:1},score_scope:'bonuses per conflicting theme; rank by total score DESC, SHA256(review_id) ASC; diversity allocation then ranked fill',priority:ADJUDICATION_PRIORITY,quota_targets:{attentiveness:3,professionalism:3,atmosphere:2},quota_achieved:Object.fromEntries(['attentiveness','professionalism','atmosphere'].map(k=>[k,selected.filter(c=>c.themes.includes(k as GoldTheme)).length])),candidate_reviews:ranked.length}}
}
export function compareAdjudication(b:AdjudicationBundle,items:AdjudicationItem[],labels:AdjudicationLabel[]) {
  const map=new Map(labels.map(l=>[l.review_id+':'+l.theme_key,l.choice])),gold=new Map(b.goldLabels.map(l=>[l.review_id+':'+l.theme_key,l.choice]))
  if(items.length!==12||new Set(items.map(i=>i.review_id)).size!==12||items.some(i=>i.themes.length<1||i.themes.length>3||i.themes.some(k=>!GOLD_CHOICES.includes(map.get(i.review_id+':'+k)!))))throw new Error('ADJUDICATION_INCOMPLETE')
  const cases=items.flatMap(item=>item.themes.map(theme=>{const human=map.get(item.review_id+':'+theme)!,g=gold.get(item.review_id+':'+theme)!,s=solChoice(b.source,item.review_id,theme),j=jevChoice(b.benchmark,item.review_id,theme);return {review_id:item.review_id,position:item.position,theme_key:theme,human,gold:g,sol:s,jev:j,gold_mismatch:human!==g,comparable:human!=='uncertain'}}))
  const valid=cases.filter(c=>c.comparable),matchesGold=valid.filter(c=>c.human===c.gold).length,matchesSol=valid.filter(c=>c.human===c.sol).length,matchesJev=valid.filter(c=>c.human===c.jev).length
  const percent=(n:number,d:number)=>d?n/d*100:null,agreement=percent(matchesGold,valid.length)
  return {methodology:'human_final_adjudication_v1',gold_set_id:b.gold.id,source_generation_id:b.source.generation_id,jev_benchmark_id:b.benchmark.id,taxonomy_version:b.gold.taxonomy_version,review_count:12,label_count:cases.length,comparable_labels:valid.length,human_matches_gold:matchesGold,human_disagrees_with_gold:valid.length-matchesGold,
    human_matches_sol_only:valid.filter(c=>c.human===c.sol&&c.human!==c.jev).length,human_matches_jev_only:valid.filter(c=>c.human===c.jev&&c.human!==c.sol).length,human_matches_both:valid.filter(c=>c.human===c.sol&&c.human===c.jev).length,human_matches_neither:valid.filter(c=>c.human!==c.sol&&c.human!==c.jev).length,human_uncertain:cases.length-valid.length,
    gold_human_agreement_percent:agreement,sol:{agreement_with_human_percent:percent(matchesSol,valid.length),matches:matchesSol,disagreements:valid.length-matchesSol},jev:{agreement_with_human_percent:percent(matchesJev,valid.length),matches:matchesJev,disagreements:valid.length-matchesJev},
    interpretation:agreement===null?'not_evaluable':agreement>=95?'very_consistent':agreement>=90?'potential_corrections':'recommend_gold_v2',by_theme:Object.fromEntries(GOLD_KEYS.map(theme=>{const rows=cases.filter(c=>c.theme_key===theme),nonUncertain=rows.filter(c=>c.comparable);return [theme,{controlled_cases:rows.length,human_matches_sol:nonUncertain.filter(c=>c.human===c.sol).length,human_matches_jev:nonUncertain.filter(c=>c.human===c.jev).length,human_matches_gold:nonUncertain.filter(c=>c.human===c.gold).length,human_uncertain:rows.length-nonUncertain.length}]})),cases,
    note:'Targeted difficult cases; not global accuracy. Jev = mean presence probabilities across 3 repetitions at threshold 0.50. Uncertain humans excluded from agreements; raw gold_mismatch records inequality and is marked non-comparable when uncertain. No original label is changed.'}
}
