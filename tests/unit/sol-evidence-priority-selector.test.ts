// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {selectSourceCompletePriorityEvidence as selectPriorityEvidence} from '../../supabase/functions/_shared/jev-priority-evidence-selection';
import {selectDirectCoverage} from '../../supabase/functions/_shared/jev-direct-evidence-selection';
import type {DirectReportEvidence} from '../../supabase/functions/_shared/jev-direct-report-preparation';
const cats=['service','price','quality','ambiance'] as const;
function evidence(id:string,category:DirectReportEvidence['category'],native:'positive'|'negative'|'mixed',rating=5,text='Source '+id+' '+category){
 return (native==='mixed'?['negative','positive']:[native]).map(polarity=>({review_id:id,category,polarity,rating,
  evidence_id:id+':'+category+':'+polarity,jev_native:{native_choice:native,classification:native,status:'classified'},
  quote:text,context:text,analysis_text_sha256:id,quote_start:0,quote_end:text.length,context_start:0,context_end:text.length,
  selection_stage:'diversification',selection_reason:'not_selected'} as DirectReportEvidence));
}
const positives=()=>cats.flatMap((c,i)=>evidence('positive_'+i,c,'positive'));
it('retains distinct critical categories of the same four-star review beyond two associations, preserving the service mixed pair',()=>{
 const source=[...evidence('multi','service','mixed',4),...evidence('multi','quality','negative',4),...evidence('multi','price','negative',4),...evidence('multi','ambiance','negative',4)];
 const pool=[...source,...positives(),...Array.from({length:40},(_,i)=>evidence('extra_'+i,cats[i%4],'positive')).flat()];
 const before=structuredClone(pool),s=selectPriorityEvidence(pool);
 expect(s.selected.filter(e=>e.review_id==='multi').map(e=>e.evidence_id).sort()).toEqual(source.map(e=>e.evidence_id).sort());
 expect(s.selected.length).toBeLessThanOrEqual(32);expect(pool).toEqual(before);expect(s.diagnostics.all_priority_source_associations_selected).toBe(true);
});
it('replaces repeated positive illustrations with priority complaints while keeping positive support in every available category',()=>{
 const complaints=Array.from({length:38},(_,i)=>evidence('critical_'+String(i).padStart(2,'0'),'quality','negative',4)).flat();
 const s=selectPriorityEvidence([...complaints,...positives(),...Array.from({length:40},(_,i)=>evidence('praise_'+i,'quality','positive')).flat()]);
 expect(s.selected).toHaveLength(32);expect(s.selected.filter(e=>e.polarity==='negative')).toHaveLength(28);
 for(const c of cats)expect(s.selected.some(e=>e.category===c&&e.polarity==='positive')).toBe(true);
 expect(s.diagnostics.omitted_priority_negative_associations).toHaveLength(10);expect(s.diagnostics.full_criticism_coverage_claimed).toBe(false);
});
it('does not give a priority complaint an extra selection slot merely because its text is long',()=>{
 const short=Array.from({length:38},(_,i)=>evidence('critical_'+String(i).padStart(2,'0'),'quality','negative',4,'Different source '+i)).flat();
 const long=short.map((e,i)=>({...e,quote:e.quote.repeat(i%2?100:1),context:e.context.repeat(i%2?100:1)}));
 const selected=(p:DirectReportEvidence[])=>selectPriorityEvidence([...p,...positives()]).selected.filter(e=>e.polarity==='negative').map(e=>e.evidence_id).sort();
 expect(selected(short)).toEqual(selected(long));
});
it('keeps five-star criticism eligible and never demands a negative source in an empty category',()=>{
 const s=selectPriorityEvidence([...evidence('low','service','negative',2),...evidence('five_star_reserve','ambiance','mixed',5),...positives()]);
 expect(s.selected.some(e=>e.review_id==='five_star_reserve'&&e.polarity==='negative')).toBe(true);
 expect(s.selected.some(e=>e.category==='price'&&e.polarity==='negative')).toBe(false);
 expect(s.diagnostics.covered_negative_categories).toEqual(['service','ambiance']);
});
it('does not evict a previously selected priority criticism for a new one when its original bundle fits',()=>{
 const pool=[...Array.from({length:36},(_,i)=>evidence('crit_'+String(i).padStart(2,'0'),'quality',i%4===0?'mixed':'negative',i%3+1,'Source '+i+' different testimony '.repeat(i+1))).flat(),...positives()];
 const before=selectDirectCoverage(pool).selected.filter(e=>e.polarity==='negative'&&e.rating<=4),after=selectPriorityEvidence(pool).selected;
 for(const e of before)expect(after.some(x=>x.evidence_id===e.evidence_id)).toBe(true);
});
it('does not split a native mixed pair to spend the last slot and reports unresolved budget arbitration',()=>{
 const s=selectPriorityEvidence(Array.from({length:4},(_,i)=>evidence('mixed_'+i,'service','mixed',4)).flat(),5);
 expect(s.selected).toHaveLength(4);for(const e of s.selected)expect(s.selected.filter(x=>x.review_id===e.review_id)).toHaveLength(2);
 expect(s.diagnostics.omitted_priority_negative_associations).toHaveLength(2);
 expect(s.trace.filter(t=>!t.selected).every(t=>t.reason==='atomic_mixed_pair_needs_two_remaining_slots')).toBe(true);
});
it('deduplicates an identical priority source in the same category without suppressing its other category',()=>{
 const text='Exactly the same full frozen review';const s=selectPriorityEvidence([...evidence('a','quality','negative',4,text),...evidence('b','quality','negative',4,text),...evidence('b','service','negative',4,text),...positives()]);
 expect(s.selected.filter(e=>e.category==='quality'&&e.polarity==='negative')).toHaveLength(1);
 expect(s.selected.some(e=>e.category==='service'&&e.polarity==='negative')).toBe(true);
 expect(s.trace.some(t=>t.reason==='exact_duplicate_same_category_and_native_label')).toBe(true);
});
it('is input-order deterministic, bounded, rejects invalid associations and never accesses the network',()=>{
 const deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'));
 try{const pool=[...evidence('alpha','service','mixed',3),...evidence('beta','quality','negative',4),...positives()];
  expect(selectPriorityEvidence(pool)).toEqual(selectPriorityEvidence([...pool].reverse()));
  expect(()=>selectPriorityEvidence(pool,33)).toThrow('DIRECT_SELECTION_BUDGET_INVALID');
  expect(()=>selectPriorityEvidence([...pool,pool[0]])).toThrow('DIRECT_SELECTION_CANDIDATE_INVALID');
  expect(()=>selectPriorityEvidence([{...pool[0],polarity:'negative',jev_native:{...pool[0].jev_native,classification:'positive'}}])).toThrow('DIRECT_SELECTION_CANDIDATE_INVALID');
  expect(deny).not.toHaveBeenCalled();
 }finally{deny.mockRestore()}
});
it('diagnoses an incomplete mixed candidate without reclassifying or inventing its missing partner',()=>{
 const s=selectPriorityEvidence([...evidence('incomplete','service','mixed',4).slice(0,1),...positives()]);
 expect(s.selected.every(e=>e.review_id!=='incomplete')).toBe(true);expect(s.diagnostics.incomplete_mixed_candidates).toHaveLength(1);
 expect(s.diagnostics.omitted_priority_negative_associations[0].reason).toBe('incomplete_native_mixed_pair');
});
