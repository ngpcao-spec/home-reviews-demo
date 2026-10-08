import {AUDIT_V8,AUDIT_V9,selectFindingAuditItems,auditSourceFingerprint,type AuditBundle,type AuditItem} from '../../supabase/functions/_shared/v9-finding-audit-core'
import {GOLD_KEYS,GOLD_TAXONOMY} from '../../supabase/functions/_shared/gold-taxonomy'
import type {FindingAudit} from '../../supabase/functions/_shared/v9-finding-audit-api'
export const fixtureUuid=(i:number)=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0')
export function syntheticFindingBundle():AuditBundle{
  const reviews=Array.from({length:45},(_,i)=>({id:fixtureUuid(i+1),analysis_text:i===44?'':`The staff checked on our table throughout the meal. Synthetic review ${i+1}.`,analysis_language:'en',rating:5,original_text:'TEXTE ORIGINAL NON AFFICHE'}))
  const common={organization_id:fixtureUuid(500),establishment_id:fixtureUuid(501),status:'completed'}
  const shared={review_id:reviews[0].id,theme_key:'food_quality' as const,sentiment:'positive' as const}
  return {v8:{...common,generation_id:AUDIT_V8,snapshot:{analysis_version:8,reviews},findings:[shared]},v9:{...common,generation_id:AUDIT_V9,snapshot:{analysis_version:9,reviews:structuredClone(reviews)},findings:[{...shared,probability_positive:.9,probability_negative:.02,repeat_stable:true},...GOLD_KEYS.flatMap((theme_key,t)=>Array.from({length:12},(_,i)=>({review_id:reviews[i+1].id,theme_key,sentiment:i%2?'positive' as const:'negative' as const,probability_positive:i%2?.5+(i%5)/10:.1,probability_negative:i%2?.1:.5+(i%5)/10,repeat_stable:(i+t)%3!==0})))]}}
}
export async function syntheticFindingAudit(){
  const bundle=syntheticFindingBundle(),selection=await selectFindingAuditItems(bundle),items:AuditItem[]=selection.items.map((i,n)=>({...i,id:fixtureUuid(n+100)}))
  const audit:FindingAudit={id:fixtureUuid(700),organization_id:bundle.v9.organization_id,source_v8_generation_id:AUDIT_V8,source_v9_generation_id:AUDIT_V9,status:'draft',target_findings:30,revision:0,taxonomy:GOLD_TAXONOMY,source_fingerprint:await auditSourceFingerprint(bundle),comparison:null,created_at:'2026-10-08T00:00:00Z',completed_at:null}
  return {bundle,selection,items,audit}
}
