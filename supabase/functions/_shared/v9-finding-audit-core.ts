import {GOLD_KEYS,GOLD_CHOICES,GOLD_TAXONOMY,type GoldTheme,type GoldChoice} from './gold-taxonomy.ts'

export const AUDIT_V8='307025ef-05b1-401e-8f6d-e48ca5677553'
export const AUDIT_V9='91b77ec8-b58c-4735-a96d-496fa1a5404a'
export const AUDIT_TARGET=30
export const AUDIT_QUOTAS={attentiveness:8,professionalism:8,coordination:6,communication:3,atmosphere:2,friendly_staff:1,other:2} as const
export interface AuditFinding {review_id:string;theme_key:GoldTheme;sentiment:'positive'|'negative';probability_positive?:number;probability_negative?:number;repeat_stable?:boolean}
export interface AuditSource {generation_id:string;organization_id:string;establishment_id:string;status:string;snapshot:{analysis_version:number;reviews:{id:string;analysis_text:string;analysis_language?:string}[]};findings:AuditFinding[]}
export interface AuditBundle {v8:AuditSource;v9:AuditSource}
export interface SelectedAuditItem {review_id:string;theme_key:GoldTheme;sentiment:'positive'|'negative';position:number;analysis_text_sha256:string;probability_positive:number;probability_negative:number;repeat_stable:boolean;selection_hash:string}
export interface AuditItem extends SelectedAuditItem {id:string}
export interface AuditLabel {item_id:string;choice:GoldChoice}
export async function auditSha256(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('')}
export const findingKey=(f:Pick<AuditFinding,'review_id'|'theme_key'|'sentiment'>)=>f.review_id+':'+f.theme_key+':'+f.sentiment
export function validateAuditSources(b:AuditBundle){
  if(b.v8.generation_id!==AUDIT_V8||b.v9.generation_id!==AUDIT_V9||b.v8.status!=='completed'||b.v9.status!=='completed'||b.v8.snapshot.analysis_version!==8||b.v9.snapshot.analysis_version!==9||b.v8.organization_id!==b.v9.organization_id||b.v8.establishment_id!==b.v9.establishment_id)throw new Error('FINDING_AUDIT_SOURCE_REQUIRED')
  const original=new Map(b.v8.snapshot.reviews.map(r=>[r.id,r])),current=b.v9.snapshot.reviews
  if(!original.size||original.size!==b.v8.snapshot.reviews.length||new Set(current.map(r=>r.id)).size!==current.length||original.size!==current.length||current.some(r=>!original.has(r.id)||typeof r.analysis_text!=='string'||r.analysis_text!==original.get(r.id)!.analysis_text||r.analysis_text.trim()&&r.analysis_language!=='en'))throw new Error('FINDING_AUDIT_DATASET_CHANGED')
  for(const source of [b.v8,b.v9])if(new Set(source.findings.map(findingKey)).size!==source.findings.length||source.findings.some(f=>!original.has(f.review_id)||!GOLD_KEYS.includes(f.theme_key)||!['positive','negative'].includes(f.sentiment)))throw new Error('FINDING_AUDIT_FINDINGS_INVALID')
  for(const f of b.v9.findings)if([f.probability_positive,f.probability_negative].some(p=>typeof p!=='number'||!Number.isFinite(p)||p<0||p>1)||typeof f.repeat_stable!=='boolean')throw new Error('FINDING_AUDIT_PROBABILITIES_INVALID')
}
export async function auditSourceFingerprint(b:AuditBundle){return auditSha256(JSON.stringify({v8:b.v8,v9:b.v9,taxonomy:GOLD_TAXONOMY,version:'gold-taxonomy-v1'}))}
export function v9OnlyFindings(b:AuditBundle){const old=new Set(b.v8.findings.map(findingKey));return b.v9.findings.filter(f=>!old.has(findingKey(f)))}
export async function selectFindingAuditItems(b:AuditBundle){
  validateAuditSources(b)
  const reviews=new Map(b.v9.snapshot.reviews.map(r=>[r.id,r]))
  const candidates=await Promise.all(v9OnlyFindings(b).filter(f=>reviews.get(f.review_id)?.analysis_text.trim()).map(async f=>({...f,probability_positive:f.probability_positive!,probability_negative:f.probability_negative!,repeat_stable:f.repeat_stable!,selection_hash:await auditSha256(AUDIT_V9+f.theme_key+f.review_id+f.sentiment),analysis_text_sha256:await auditSha256(reviews.get(f.review_id)!.analysis_text)})))
  candidates.sort((a,c)=>a.selection_hash.localeCompare(c.selection_hash)||findingKey(a).localeCompare(findingKey(c)))
  if(candidates.length<AUDIT_TARGET)throw new Error('FINDING_AUDIT_INSUFFICIENT_FINDINGS')
  const priority=Object.keys(AUDIT_QUOTAS).filter(k=>k!=='other') as GoldTheme[],selected:typeof candidates=[]
  for(const theme of priority)selected.push(...candidates.filter(f=>f.theme_key===theme).slice(0,AUDIT_QUOTAS[theme as keyof typeof AUDIT_QUOTAS]))
  selected.push(...candidates.filter(f=>!priority.includes(f.theme_key)).slice(0,AUDIT_QUOTAS.other))
  const used=new Set(selected.map(findingKey));for(const f of candidates)if(selected.length<AUDIT_TARGET&&!used.has(findingKey(f))){selected.push(f);used.add(findingKey(f))}
  // Presentation order is also a hash order, independent of scores, polarity or probabilities.
  selected.sort((a,c)=>a.selection_hash.localeCompare(c.selection_hash)||findingKey(a).localeCompare(findingKey(c)))
  return {items:selected.map((f,i)=>({...f,position:i+1})),selection:{methodology:'v9_only_finding_audit_v1',selection_method:'SHA256(v9_generation_id + theme_key + review_id + sentiment) ASC; theme quotas then global hash fill',quota_targets:AUDIT_QUOTAS,quota_achieved:Object.fromEntries([...priority,'other'].map(k=>[k,selected.filter(f=>k==='other'?!priority.includes(f.theme_key):f.theme_key===k).length])),candidate_findings:candidates.length,dataset_reviews:reviews.size}}
}
export async function validateStoredAuditItems(items:AuditItem[],b:AuditBundle){
  if(items.length!==AUDIT_TARGET||new Set(items.map(findingKey)).size!==AUDIT_TARGET||new Set(items.map(i=>i.id)).size!==AUDIT_TARGET||new Set(items.map(i=>i.position)).size!==AUDIT_TARGET)throw new Error('FINDING_AUDIT_ITEMS_INVALID')
  const candidates=new Map(v9OnlyFindings(b).map(f=>[findingKey(f),f])),reviews=new Map(b.v9.snapshot.reviews.map(r=>[r.id,r]))
  for(const item of items){const f=candidates.get(findingKey(item)),text=reviews.get(item.review_id)?.analysis_text;if(!f||!text?.trim()||item.position<1||item.position>AUDIT_TARGET||await auditSha256(text)!==item.analysis_text_sha256||item.probability_positive!==f.probability_positive||item.probability_negative!==f.probability_negative||item.repeat_stable!==f.repeat_stable)throw new Error('FINDING_AUDIT_SOURCE_CHANGED')}
}
export function compareFindingAudit(items:AuditItem[],labels:AuditLabel[]){
  const choices=new Map(labels.map(l=>[l.item_id,l.choice]))
  if(items.length!==AUDIT_TARGET||new Set(items.map(findingKey)).size!==AUDIT_TARGET||items.some(i=>!GOLD_CHOICES.includes(choices.get(i.id)!)))throw new Error('FINDING_AUDIT_INCOMPLETE')
  const cases=items.map(item=>{const human=choices.get(item.id)!,outcome=human==='uncertain'?'uncertain':human===item.sentiment||human==='both'?'validated':'rejected';return {...item,human,outcome} as const})
  const tally=(rows:typeof cases)=>{const validated=rows.filter(c=>c.outcome==='validated').length,rejected=rows.filter(c=>c.outcome==='rejected').length;return {controlled:rows.length,validated,rejected,uncertain:rows.length-validated-rejected,comparable:validated+rejected,validation_rate:validated+rejected?validated/(validated+rejected):null}}
  const global=tally(cases)
  return {methodology:'v9_only_finding_audit_v1',taxonomy_version:'gold-taxonomy-v1',source_v8_generation_id:AUDIT_V8,source_v9_generation_id:AUDIT_V9,...global,
    interpretation:global.validation_rate===null?'not_evaluable':global.validation_rate>=.85?'very_good_additional_signal':global.validation_rate>=.70?'useful_requires_calibration':'probable_over_detection',
    by_theme:Object.fromEntries(GOLD_KEYS.filter(k=>cases.some(c=>c.theme_key===k)).map(k=>[k,tally(cases.filter(c=>c.theme_key===k))])),
    exploratory_thresholds:[.50,.60,.70,.80,.90].map(threshold=>{const retained=cases.filter(c=>(c.sentiment==='positive'?c.probability_positive:c.probability_negative)>=threshold),counts=tally(retained);return {threshold,exploratory:true,...counts,removed_validated:global.validated-counts.validated,removed_rejected:global.rejected-counts.rejected,retained_validated_fraction:global.validated?counts.validated/global.validated:null}}),
    stability:{stable:tally(cases.filter(c=>c.repeat_stable)),unstable:tally(cases.filter(c=>!c.repeat_stable))},cases,
    note:'Quota sample of V9-only findings. Observed validation rates are sample-specific, not global accuracy or recall. Uncertain excluded. Thresholds exploratory only; no production changes.'}
}
