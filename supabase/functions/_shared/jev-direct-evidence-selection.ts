// Future direct-four selections only. Native classifications and source evidence
// are inputs, never rewritten. The historical selector remains unchanged.
import {selectBalancedEvidence,balancedSelectorHash} from './jev-hybrid-balanced.ts';
import {nearDuplicateMemo} from './pilot-evidence-v3-audit.ts';
import {DIRECT_CATEGORY_KEYS,directHash} from './jev-direct-categories.ts';
import type {DirectReportEvidence} from './jev-direct-report-preparation.ts';

export const DIRECT_COVERAGE_VERSION='jls-direct4-negative-mixed-coverage-v1';
export const DIRECT_COVERAGE_POLICY=Object.freeze({version:DIRECT_COVERAGE_VERSION,max_evidence:32,
 negative_category_min_if_available:1,mixed:'atomic_positive_negative_pair',normal_max_per_review:2,
 review_cap_exceptions:['required_negative_category','complete_mixed_pair'],
 priority:['negative_category_coverage','existing_balanced_diversification'],
 incomplete_pair:'omit_and_diagnose',insufficient_budget:'diagnose_never_claim_complete',
 text:'one_frozen_review_per_compact_reference',classifications:'native_unchanged',
 semantic_validation:false});
export async function directCoverageSelectorHash(){return directHash({policy:DIRECT_COVERAGE_POLICY,
 base_selector_sha256:await balancedSelectorHash(),algorithm:'negative_categories_then_atomic_mixed_bundles_in_legacy_order_then_stable_remaining_v1'});}

export function selectDirectCoverage(candidates:DirectReportEvidence[],max=32){
 const nearDuplicate=nearDuplicateMemo();
 if(!Number.isInteger(max)||max<0||max>DIRECT_COVERAGE_POLICY.max_evidence)throw Error('DIRECT_SELECTION_BUDGET_INVALID');
 const seen=new Set<string>(),keys=new Set<string>();
 for(const e of candidates){const key=[e.review_id,e.category,e.polarity].join(':');
  if(seen.has(e.evidence_id)||keys.has(key)||!DIRECT_CATEGORY_KEYS.includes(e.category)||
   e.jev_native.status!=='classified'||!['positive','negative','mixed'].includes(e.jev_native.classification??'')||
   e.jev_native.classification!==e.polarity&&e.jev_native.classification!=='mixed')throw Error('DIRECT_SELECTION_CANDIDATE_INVALID');
  seen.add(e.evidence_id);keys.add(key);
 }
 const view=candidates.map(e=>({...e,theme_key:e.category,axis:e.category==='ambiance'?'atmosphere':e.category,
  mixed_review:e.jev_native.classification==='mixed',status:'sol_candidate' as const,
  quality:{eligible:true,specificity:Math.min(60,e.quote.length/8),flags:[] as string[],reason:'EXACT_FULL_REVIEW_CANDIDATE_NOT_SEMANTIC_VALIDATION',human_validated:false as const}}));
 // Keep the existing preference ordering, but apply coverage BEFORE its quotas
 // and diversification. No lexical reclassification is introduced here.
 const preferred=selectBalancedEvidence(view,max,{same_review_distinct_associations:true});
 const rank=new Map(preferred.map((e,n)=>[e.evidence_id,n]));
 const ordered=[...candidates].sort((a,b)=>(rank.get(a.evidence_id)??Infinity)-(rank.get(b.evidence_id)??Infinity)||
  Number(b.polarity==='negative')-Number(a.polarity==='negative')||
  Math.min(60,b.quote.length/8)-Math.min(60,a.quote.length/8)||a.quote.length-b.quote.length||a.evidence_id.localeCompare(b.evidence_id));
 const selected:DirectReportEvidence[]=[],chosen=new Set<string>();
 const bundle=(e:DirectReportEvidence)=>{
  if(e.jev_native.classification!=='mixed')return [e];
  const pair=candidates.filter(x=>x.review_id===e.review_id&&x.category===e.category&&
   x.jev_native.classification==='mixed'&&x.analysis_text_sha256===e.analysis_text_sha256&&x.quote===e.quote&&x.context===e.context);
  return pair.length===2&&pair.some(x=>x.polarity==='positive')&&pair.some(x=>x.polarity==='negative')?
   [...pair].sort((a,b)=>a.polarity.localeCompare(b.polarity)):[];
 };
 const take=(e:DirectReportEvidence,required:boolean)=>{
  const group=bundle(e);if(!group.length)return false;
  const extra=group.filter(x=>!chosen.has(x.evidence_id));if(!extra.length||selected.length+extra.length>max)return false;
  if(!required){
   // A mixed pair is inseparable, including when another category from this
   // review was needed for coverage. Ordinary extra examples keep the old cap.
   if(group.length===1&&selected.filter(x=>x.review_id===e.review_id).length>=DIRECT_COVERAGE_POLICY.normal_max_per_review)return false;
   if(selected.some(x=>x.review_id!==e.review_id&&nearDuplicate(x.quote,e.quote)))return false;
  }
  for(const x of extra){chosen.add(x.evidence_id);selected.push({...x,selection_stage:required?'priority_coverage':'diversification',
   selection_reason:required?'required_negative_category_with_complete_mixed_pair':group.length===2?'complete_mixed_pair_before_extra_diversification':'existing_balanced_diversification'});}
  return true;
 };
 const required=DIRECT_CATEGORY_KEYS.filter(c=>candidates.some(e=>e.category===c&&e.polarity==='negative'));
 for(const category of required){if(selected.some(e=>e.category===category&&e.polarity==='negative'))continue;
  for(const e of ordered.filter(e=>e.category===category&&e.polarity==='negative'))if(take(e,true))break;
 }
 for(const e of ordered)take(e,false);
 const missing_negative_categories=required.filter(c=>!selected.some(e=>e.category===c&&e.polarity==='negative')).map(category=>({category,
  candidate_evidence_ids:candidates.filter(e=>e.category===category&&e.polarity==='negative').map(e=>e.evidence_id).sort(),
  reason:candidates.some(e=>e.category===category&&e.polarity==='negative'&&bundle(e).length)?'association_budget_insufficient':'complete_mixed_pair_unavailable'}));
 const incomplete_mixed_candidates=candidates.filter(e=>e.jev_native.classification==='mixed'&&!bundle(e).length).map(e=>e.evidence_id).sort();
 const mixed_groups=[...new Set(selected.filter(e=>e.jev_native.classification==='mixed').map(e=>e.review_id+':'+e.category))];
 const review_cap_exceptions=[...new Set(selected.map(e=>e.review_id))].filter(id=>selected.filter(e=>e.review_id===id).length>DIRECT_COVERAGE_POLICY.normal_max_per_review)
  .map(review_id=>({review_id,associations:selected.filter(e=>e.review_id===review_id).length,reason:'negative_coverage_and_inseparable_mixed_pairs'}));
 return {selected,diagnostics:{version:DIRECT_COVERAGE_VERSION,max_evidence:max,selected:selected.length,
  required_negative_categories:required,covered_negative_categories:required.filter(c=>!missing_negative_categories.some(x=>x.category===c)),
  missing_negative_categories,selected_mixed_groups:mixed_groups.length,incomplete_mixed_candidates,review_cap_exceptions,
  coverage_complete:!missing_negative_categories.length&&!incomplete_mixed_candidates.length,
  diversity_is_not_statistical_representativeness:true,semantic_accuracy_measured:false}};
}
