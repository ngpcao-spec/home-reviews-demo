// Offline proposal only. Not imported by production, registered or deployable
// through a server option. Native answers, mixed pairs and budget are unchanged.
import {selectDirectCoverage} from '../../supabase/functions/_shared/jev-direct-evidence-selection.ts';
import {nearDuplicateMemo} from '../../supabase/functions/_shared/pilot-evidence-v3-audit.ts';
import {DIRECT_CATEGORY_KEYS} from '../../supabase/functions/_shared/jev-direct-categories.ts';
import type {DirectReportEvidence} from '../../supabase/functions/_shared/jev-direct-report-preparation.ts';

export const MIXED_SOURCE_COMPLETION_POLICY=Object.freeze({
 version:'sol-evidence-started-source-mixed-completion-proposal-v1',production_enabled:false,max_associations:32,
 priority:'native_negative_or_atomic_mixed_from_1_to_4_stars',
 priority_review_cap:null,ordinary_review_cap:2,mixed:'inseparable_native_positive_negative_pair',
 priority_order:'preserve_current_negative_sources_then_atomic_negative_or_mixed_binding_of_started_source_then_existing_ties',
 priority_text_length_score:false,priority_confidence_score:false,
 priority_duplicates:'same_category_and_native_label_and_NFC_whitespace_normalized_exact_text',
 positive_reserve:'one_native_positive_illustration_per_available_category_if_budget_feasible',
 completion:'saved_current_selector_order_then_stable_remaining_candidates',
 five_star_criticism:'eligible_in_completion_no_exclusion',
 semantic_importance_available:false,coverage_unit:'source_review_category_association_not_distinct_incident',
});
type Evidence=DirectReportEvidence;
type Stage='priority'|'positive_reserve'|'completion';
const normalize=(s:string)=>s.normalize('NFC').replace(/\s+/gu,' ').trim();
const key=(e:Evidence)=>e.review_id+':'+e.category;
const low=(e:Evidence)=>Number.isInteger(e.rating)&&e.rating>=1&&e.rating<=4;

export function selectMixedSourceCompletePriorityEvidence(candidates:Evidence[],max=32){
 // Reuse the current admissibility checks and its exact selected order. Its
 // output is a preference, never a native result or a new source of evidence.
 const legacy=selectDirectCoverage(candidates,max),legacyRank=new Map(legacy.selected.map((e,i)=>[e.evidence_id,i]));
 const stable=[...candidates].sort((a,b)=>a.evidence_id.localeCompare(b.evidence_id));
 const groups=new Map<string,Evidence[]>();
 for(const e of stable)groups.set(key(e),[...(groups.get(key(e))??[]),e]);
 const bundle=(e:Evidence)=>{
  if(e.jev_native.classification!=='mixed')return [e];
  const pair=groups.get(key(e))!.filter(x=>x.jev_native.classification==='mixed'&&x.analysis_text_sha256===e.analysis_text_sha256&&x.quote===e.quote&&x.context===e.context);
  return pair.length===2&&pair.some(x=>x.polarity==='negative')&&pair.some(x=>x.polarity==='positive')?pair:[];
 };
 const valid=stable.filter(e=>bundle(e).length),selected:Evidence[]=[],chosen=new Set<string>(),stages=new Map<string,Stage>();
 const positiveCategories=DIRECT_CATEGORY_KEYS.filter(c=>valid.some(e=>e.category===c&&e.polarity==='positive'));
 const extra=(e:Evidence)=>bundle(e).filter(x=>!chosen.has(x.evidence_id));
 const positivePresent=(c:string,additional:Evidence[]=[])=>[...selected,...additional].some(e=>e.category===c&&e.polarity==='positive');
 const positiveCost=(c:string,additional:Evidence[]=[])=>{
  if(positivePresent(c,additional))return 0;
  const added=new Set(additional.map(e=>e.evidence_id));
  return Math.min(...valid.filter(e=>e.category===c&&e.polarity==='positive').map(e=>extra(e).filter(x=>!added.has(x.evidence_id)).length));
 };
 // Four categories at most. This is an illustration floor, not an instruction
 // to Sol to invent a positive claim or a negative recommendation per category.
 const targets:typeof positiveCategories=[];
 for(const c of positiveCategories)if(targets.reduce((s,x)=>s+positiveCost(x),0)+positiveCost(c)<=max)targets.push(c);
 const reserve=(additional:Evidence[]=[])=>targets.reduce((s,c)=>s+positiveCost(c,additional),0);
 const duplicate=(e:Evidence)=>selected.find(s=>s.review_id!==e.review_id&&s.category===e.category&&s.jev_native.classification===e.jev_native.classification&&normalize(s.quote)===normalize(e.quote));
 const nearDuplicate=nearDuplicateMemo();
 const failure=(e:Evidence,stage:Stage,protect:boolean):string|null=>{
  if(!bundle(e).length)return 'incomplete_native_mixed_pair';
  const added=extra(e);if(!added.length)return null;
  if(selected.length+added.length>max)return added.length===2&&max-selected.length===1?'atomic_mixed_pair_needs_two_remaining_slots':'association_budget_32';
  if(stage==='priority'&&duplicate(e))return 'exact_duplicate_same_category_and_native_label';
  if(protect&&selected.length+added.length+reserve(added)>max)return 'association_budget_with_positive_illustration_reserve';
  if(stage==='completion'){
   if(bundle(e).length===1&&selected.filter(s=>s.review_id===e.review_id).length>=2)return 'ordinary_review_cap_2';
   if(selected.some(s=>s.review_id!==e.review_id&&nearDuplicate(s.quote,e.quote)))return 'current_near_duplicate_filter';
  }
  return null;
 };
 const take=(e:Evidence,stage:Stage,protect=false)=>{
  if(failure(e,stage,protect))return false;
  const added=extra(e);if(!added.length)return false;
  for(const x of added){chosen.add(x.evidence_id);stages.set(x.evidence_id,stage);selected.push({...x,
   selection_stage:stage==='completion'?'diversification':'priority_coverage',
   selection_reason:stage==='priority'?'priority_1_to_4_star_negative_native_bundle':stage==='positive_reserve'?'available_category_positive_illustration':'current_order_after_critical_sources'});}
  return true;
 };
 const priority=stable.filter(e=>low(e)&&e.polarity==='negative');
 // Review/category groups, never text length or a lexical severity dictionary.
 // No two-association cap can suppress a further critical category of a review.
 for(;;){
  const pool=priority.filter(e=>!chosen.has(e.evidence_id)&&!failure(e,'priority',true));
  if(!pool.length)break;
  const countCategory=(e:Evidence)=>selected.filter(s=>s.category===e.category&&s.polarity==='negative').length;
  const countReview=(e:Evidence)=>selected.filter(s=>s.review_id===e.review_id&&s.polarity==='negative').length;
  // Avoid trading an existing priority criticism for a new one when the change
  // can instead displace an ordinary positive illustration. This preserves a
  // source, not a claim that the legacy ranking establishes semantic importance.
  const started=(e:Evidence)=>selected.some(s=>s.review_id===e.review_id&&s.polarity==='negative'&&s.category!==e.category);
  // Complete an already started source for either native negative or mixed.
  // The same indivisible bundle, budget and positive reserve checks apply.
  pool.sort((a,b)=>Number(legacyRank.has(b.evidence_id))-Number(legacyRank.has(a.evidence_id))||Number(started(b))-Number(started(a))||countCategory(a)-countCategory(b)||countReview(a)-countReview(b)||a.evidence_id.localeCompare(b.evidence_id));
  take(pool[0],'priority',true);
 }
 const priorityStageEnd={selected_associations:selected.length,free_associations:max-selected.length,reserved_positive_associations:reserve()};
 const priorityEndReasons=new Map(priority.filter(e=>!chosen.has(e.evidence_id)).map(e=>[e.evidence_id,failure(e,'priority',true)]));
 // Use an already preferred positive when possible. Minimum bundle cost is
 // necessary to honor the reservation; a mixed illustration costs two slots.
 for(const c of targets){
  if(positivePresent(c))continue;
  const pool=valid.filter(e=>e.category===c&&e.polarity==='positive'&&!chosen.has(e.evidence_id));
  pool.sort((a,b)=>extra(a).length-extra(b).length||(legacyRank.get(a.evidence_id)??Infinity)-(legacyRank.get(b.evidence_id)??Infinity)||a.evidence_id.localeCompare(b.evidence_id));
  for(const e of pool)if(take(e,'positive_reserve'))break;
 }
 const completion=[...valid].sort((a,b)=>(legacyRank.get(a.evidence_id)??Infinity)-(legacyRank.get(b.evidence_id)??Infinity)||a.evidence_id.localeCompare(b.evidence_id));
 for(const e of completion)take(e,'completion');
 const omittedPriority=priority.filter(e=>!chosen.has(e.evidence_id)).map(e=>({evidence_id:e.evidence_id,review_id:e.review_id,category:e.category,rating:e.rating,reason:failure(e,'priority',true)??'not_selected_in_priority_order',priority_stage_reason:priorityEndReasons.get(e.evidence_id)??null,duplicate_of:duplicate(e)?.evidence_id??null}));
 const trace=stable.map(e=>({evidence_id:e.evidence_id,review_id:e.review_id,category:e.category,polarity:e.polarity,rating:e.rating,
  native_label:e.jev_native.classification,priority:low(e)&&['negative','mixed'].includes(e.jev_native.classification??''),
  selected:chosen.has(e.evidence_id),stage:stages.get(e.evidence_id)??null,
  reason:chosen.has(e.evidence_id)?selected.find(x=>x.evidence_id===e.evidence_id)!.selection_reason:
   failure(e,low(e)&&e.jev_native.classification!=='positive'?'priority':'completion',false)??'not_selected_in_completion_order'}));
 return {selected,trace,diagnostics:{version:MIXED_SOURCE_COMPLETION_POLICY.version,max_associations:max,selected_associations:selected.length,
  selected_reviews:new Set(selected.map(e=>e.review_id)).size,priority_stage_end:priorityStageEnd,priority_negative_candidates:priority.length,
  selected_priority_negative_associations:priority.filter(e=>chosen.has(e.evidence_id)).length,omitted_priority_negative_associations:omittedPriority,
  all_priority_source_associations_selected:omittedPriority.length===0,
  selected_negative_associations:selected.filter(e=>e.polarity==='negative').length,selected_positive_associations:selected.filter(e=>e.polarity==='positive').length,
  positive_illustration_categories:positiveCategories,positive_reserve_targets:targets,missing_positive_illustration_categories:positiveCategories.filter(c=>!positivePresent(c)),
  mixed_pairs:selected.filter(e=>e.jev_native.classification==='mixed'&&e.polarity==='negative').length,
  incomplete_mixed_candidates:stable.filter(e=>!bundle(e).length).map(e=>e.evidence_id),
  covered_negative_categories:DIRECT_CATEGORY_KEYS.filter(c=>selected.some(e=>e.category===c&&e.polarity==='negative')),
  reviews_over_ordinary_cap:[...new Set(selected.map(e=>e.review_id))].filter(id=>selected.filter(e=>e.review_id===id).length>2).map(id=>({review_id:id,associations:selected.filter(e=>e.review_id===id).length,stages:[...new Set(selected.filter(e=>e.review_id===id).map(e=>stages.get(e.evidence_id)))]})),
  semantic_importance_measured:false,distinct_incident_coverage_measured:false,full_criticism_coverage_claimed:false}};
}
