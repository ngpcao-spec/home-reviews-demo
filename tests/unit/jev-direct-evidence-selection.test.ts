import {expect,it} from 'vitest';
import {DIRECT_CATEGORY_KEYS} from '../../supabase/functions/_shared/jev-direct-categories';
import {selectDirectCoverage,DIRECT_COVERAGE_VERSION} from '../../supabase/functions/_shared/jev-direct-evidence-selection';
import type {DirectReportEvidence} from '../../supabase/functions/_shared/jev-direct-report-preparation';

function evidence(review:string,category:DirectReportEvidence['category'],native:'positive'|'negative'|'mixed',text=review.repeat(25)){
 return (native==='mixed'?['positive','negative']:[native]).map(polarity=>({review_id:review,category,polarity,
  evidence_id:[review,category,polarity].join(':'),jev_native:{classification:native,status:'classified'},quote:text,context:text,
  analysis_text_sha256:review,quote_start:0,quote_end:text.length,context_start:0,context_end:text.length,rating:5,
  selection_stage:'diversification',selection_reason:'not_selected'} as DirectReportEvidence));
}
it('reserves negative categories before diversification and keeps selected mixed pairs intact, without mutating native data',()=>{
 const pool=[...evidence('only_ambiance','ambiance','negative'),...evidence('only_ambiance','service','mixed'),
  ...evidence('quality_complaint','quality','mixed'),...evidence('price_complaint','price','negative'),
  ...Array.from({length:45},(_,n)=>evidence('favorable_'+n,DIRECT_CATEGORY_KEYS[n%4],'positive')).flat()];
 const before=JSON.stringify(pool),s=selectDirectCoverage(pool);
 expect(s.diagnostics.coverage_complete).toBe(true);expect(s.diagnostics.covered_negative_categories).toEqual([...DIRECT_CATEGORY_KEYS]);
 expect(s.selected.length).toBeLessThanOrEqual(32);expect(JSON.stringify(pool)).toBe(before);
 for(const e of s.selected.filter(e=>e.jev_native.classification==='mixed'))expect(s.selected.filter(x=>x.review_id===e.review_id&&x.category===e.category).map(x=>x.polarity).sort()).toEqual(['negative','positive']);
 expect(new Set(s.selected.map(e=>e.evidence_id)).size).toBe(s.selected.length);
 expect(s.diagnostics.version).toBe(DIRECT_COVERAGE_VERSION);
});
it('allows the required category and an inseparable mixed pair to exceed the normal two-association review cap',()=>{
 const s=selectDirectCoverage([...evidence('a','ambiance','negative'),...evidence('a','service','mixed')]);
 expect(s.selected).toHaveLength(3);expect(s.diagnostics.review_cap_exceptions).toEqual([{review_id:'a',associations:3,reason:'negative_coverage_and_inseparable_mixed_pairs'}]);
});
it('never cuts a mixed pair to fill the last slot and reports the exact unavailable coverage',()=>{
 const pool=evidence('isolated','service','mixed'),s=selectDirectCoverage(pool,1);
 expect(s.selected).toEqual([]);expect(s.diagnostics.coverage_complete).toBe(false);
 expect(s.diagnostics.missing_negative_categories).toEqual([{category:'service',candidate_evidence_ids:['isolated:service:negative'],reason:'association_budget_insufficient'}]);
 expect(selectDirectCoverage(pool,2).selected).toHaveLength(2);
});
it('omits a malformed incomplete pair instead of silently converting a mixed opinion into one polarity',()=>{
 const s=selectDirectCoverage(evidence('missing','price','mixed').slice(1));expect(s.selected).toEqual([]);
 expect(s.diagnostics.missing_negative_categories[0].reason).toBe('complete_mixed_pair_unavailable');
 expect(s.diagnostics.incomplete_mixed_candidates).toEqual(['missing:price:negative']);
});
it('retains the only negative source even when its full text duplicates a source of another category',()=>{
 const same='A complete mixed review with several category observations.',pool=[...evidence('a','service','negative',same),...evidence('b','ambiance','negative',same)];
 expect(selectDirectCoverage(pool).diagnostics.covered_negative_categories).toEqual(['service','ambiance']);
});
it('is deterministic for permuted inputs and does not require a negative example for a category without one',()=>{
 const pool=[...evidence('alpha','service','mixed'),...evidence('beta','quality','negative'),...evidence('gamma','ambiance','positive')];
 expect(selectDirectCoverage(pool)).toEqual(selectDirectCoverage([...pool].reverse()));
 expect(selectDirectCoverage(pool).diagnostics.required_negative_categories).toEqual(['service','quality']);
});
it('preserves the hard cap and refuses duplicate or incompatible native associations',()=>{
 const one=evidence('a','price','positive');expect(()=>selectDirectCoverage([...one,...one])).toThrow('DIRECT_SELECTION_CANDIDATE_INVALID');
 expect(()=>selectDirectCoverage(one,33)).toThrow('DIRECT_SELECTION_BUDGET_INVALID');
 expect(()=>selectDirectCoverage([{...one[0],polarity:'negative'}])).toThrow('DIRECT_SELECTION_CANDIDATE_INVALID');
});
