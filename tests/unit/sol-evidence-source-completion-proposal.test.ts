// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {selectDirectCoverage as selectPriorityEvidence} from '../../supabase/functions/_shared/jev-direct-evidence-selection';
import {selectSourceCompletePriorityEvidence} from '../../supabase/functions/_shared/jev-priority-evidence-selection';
import type {DirectReportEvidence} from '../../supabase/functions/_shared/jev-direct-report-preparation';
const cats=['service','price','quality','ambiance'] as const;
function evidence(id:string,category:DirectReportEvidence['category'],native:'positive'|'negative'|'mixed',rating:number,text:string){
 return (native==='mixed'?['negative','positive']:[native]).map(polarity=>({review_id:id,category,polarity,rating,
  evidence_id:id+':'+category+':'+polarity,jev_native:{native_choice:native,classification:native,status:'classified'},
  quote:text,context:text,analysis_text_sha256:id,quote_start:0,quote_end:text.length,context_start:0,context_end:text.length,
  selection_stage:'diversification',selection_reason:'not_selected'} as DirectReportEvidence));
}
const positive=()=>cats.flatMap(c=>evidence('p_'+c,c,'positive',5,'Distinct favorable '+c));
it('completes an omitted critical category of an already retained source before another new source in an already illustrated category',()=>{
 const multi=[...evidence('zz_multi','service','negative',2,'A concise multi-category source'),...evidence('zz_multi','price','negative',2,'A concise multi-category source'),...evidence('zz_multi','quality','negative',2,'A concise multi-category source')];
 const pool=[...multi,...Array.from({length:30},(_,i)=>evidence('a_'+String(i).padStart(2,'0'),'quality','negative',3,'Other source '+i+' longer illustrative testimony '.repeat(8))).flat(),...positive()],before=structuredClone(pool);
 const old=selectPriorityEvidence(pool),proposal=selectSourceCompletePriorityEvidence(pool),id='zz_multi:quality:negative';
 expect(old.selected.some(e=>e.evidence_id===id)).toBe(false);expect(proposal.selected.some(e=>e.evidence_id===id)).toBe(true);
 expect(proposal.selected.length).toBeLessThanOrEqual(32);expect(pool).toEqual(before);
 for(const c of cats)expect(proposal.selected.some(e=>e.category===c&&e.polarity==='positive')).toBe(true);
});
it('preserves native mixed pairs, original values, and already preferred priority criticisms under the same budget',()=>{
 const pool=[...evidence('a','service','mixed',4,'Customer reports a problem and a helpful response'),...evidence('a','quality','negative',4,'Customer reports a problem and a helpful response'),...positive()];
 const before=structuredClone(pool),s=selectSourceCompletePriorityEvidence(pool);
 expect(s.selected.filter(e=>e.review_id==='a'&&e.category==='service').map(e=>e.polarity).sort()).toEqual(['negative','positive']);
 expect(s.selected.some(e=>e.review_id==='a'&&e.category==='quality')).toBe(true);expect(pool).toEqual(before);
});
it('is deterministic and does not add a five-star exclusion or any network action',()=>{
 const deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'));
 try{const pool=[...evidence('low','service','negative',2,'An operational problem'),...evidence('five','ambiance','mixed',5,'Nice room with a specific reservation'),...positive()];
  const a=selectSourceCompletePriorityEvidence(pool);expect(a).toEqual(selectSourceCompletePriorityEvidence([...pool].reverse()));
  expect(a.selected.some(e=>e.review_id==='five'&&e.polarity==='negative')).toBe(true);expect(deny).not.toHaveBeenCalled();
 }finally{deny.mockRestore()}
});
