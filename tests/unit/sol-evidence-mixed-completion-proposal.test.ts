// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {selectSourceCompletePriorityEvidence as active} from '../../supabase/functions/_shared/jev-priority-evidence-selection';
import {evidenceSelectorBinding} from '../../supabase/functions/_shared/report-evidence-selector';
import {selectMixedSourceCompletePriorityEvidence as proposal,MIXED_SOURCE_COMPLETION_POLICY} from '../../experiments/evidence-priority/mixed-source-completion-proposal';
import type {DirectReportEvidence} from '../../supabase/functions/_shared/jev-direct-report-preparation';

const cats=['service','price','quality','ambiance'] as const;
function evidence(id:string,category:DirectReportEvidence['category'],native:'positive'|'negative'|'mixed',rating=4,text='Distinct testimony '+id){
 return (native==='mixed'?['negative','positive']:[native]).map(polarity=>({review_id:id,category,polarity,rating,
  evidence_id:id+':'+category+':'+polarity,jev_native:{native_choice:native,classification:native,status:'classified',native_confidence:native==='mixed'?.41:.99,probabilities:native==='mixed'?{mixed:.51,negative:.49}:{[native]:1}},
  quote:text,context:text,analysis_text_sha256:id,quote_start:0,quote_end:text.length,context_start:0,context_end:text.length,
  selection_stage:'diversification',selection_reason:'not_selected'} as DirectReportEvidence));
}
const positives=()=>cats.flatMap(c=>evidence('p_'+c,c,'positive',5));
function crowded(native:'negative'|'mixed'){
 // A crowded legacy ranking can retain service/price but reject the further
 // category as similar to another review. The priority pass only deduplicates
 // exact text, so the source completion tie break is then material.
 const common='A customer describes an ordinary visit with several observations and contextual details. '.repeat(8),text=common+'Customer contextual details.';
 return [...evidence('zz_multi','service','negative',2,text),...evidence('zz_multi','price','negative',2,text),...evidence('zz_multi','quality',native,2,text),
  ...Array.from({length:30},(_,i)=>evidence('a_'+String(i).padStart(2,'0'),'quality','negative',1,common+String(i))).flat(),...positives()];
}
const quality=(s:ReturnType<typeof proposal>)=>s.selected.filter(e=>e.review_id==='zz_multi'&&e.category==='quality').map(e=>e.polarity).sort();

it('preserves completion when a saved classification changes from negative to mixed, including both native associations',()=>{
 const negative=crowded('negative'),mixed=crowded('mixed'),unchanged=structuredClone(mixed);
 expect(quality(active(negative))).toEqual(['negative']);
 expect(quality(active(mixed))).toEqual([]);
 expect(quality(proposal(negative))).toEqual(['negative']);
 const s=proposal(mixed);expect(quality(s)).toEqual(['negative','positive']);expect(s.selected).toHaveLength(32);
 for(const c of cats)expect(s.selected.some(e=>e.category===c&&e.polarity==='positive')).toBe(true);
 expect(mixed).toEqual(unchanged);
 for(const e of s.selected)expect(e.jev_native).toEqual(mixed.find(x=>x.evidence_id===e.evidence_id)!.jev_native);
});

it('reports the displaced source under a full budget rather than claiming complete coverage',()=>{
 const input=crowded('mixed'),before=active(input),after=proposal(input);
 const removed=before.selected.filter(e=>!after.selected.some(x=>x.evidence_id===e.evidence_id));
 expect(removed.length).toBeGreaterThan(0);
 expect(after.diagnostics.omitted_priority_negative_associations.length).toBeGreaterThan(0);
 expect(after.diagnostics.full_criticism_coverage_claimed).toBe(false);
 expect(after.diagnostics.semantic_importance_measured).toBe(false);
 for(const e of after.selected.filter(e=>e.jev_native.classification==='mixed'))expect(after.selected.filter(x=>x.review_id===e.review_id&&x.category===e.category)).toHaveLength(2);
});

it('leaves the last place unused when a complete mixed pair requires two places',()=>{
 const s=proposal(Array.from({length:4},(_,i)=>evidence('mixed_'+i,'service','mixed',4)).flat(),5);
 expect(s.selected).toHaveLength(4);
 for(const e of s.selected)expect(s.selected.filter(x=>x.review_id===e.review_id&&x.category===e.category)).toHaveLength(2);
 expect(s.diagnostics.omitted_priority_negative_associations).toHaveLength(2);
 expect(s.trace.filter(t=>!t.selected).every(t=>t.reason==='atomic_mixed_pair_needs_two_remaining_slots')).toBe(true);
 expect(s.selected.some(e=>e.category==='service'&&e.polarity==='positive')).toBe(true);
});

it('does not invent the missing half of a mixed answer or count an identical category twice',()=>{
 const pair=evidence('source','quality','mixed',2),text='One identical complete customer testimony';
 const s=proposal([...evidence('source','service','negative',2),pair[0],...evidence('duplicate_a','price','negative',3,text),...evidence('duplicate_b','price','negative',3,text),...positives()]);
 expect(s.selected.some(e=>e.review_id==='source'&&e.category==='quality')).toBe(false);
 expect(s.diagnostics.incomplete_mixed_candidates).toContain(pair[0].evidence_id);
 expect(s.selected.filter(e=>e.category==='price'&&e.polarity==='negative')).toHaveLength(1);
});

it('keeps five-star criticism eligible, is deterministic, and does not rank native confidence',()=>{
 const input=[...crowded('mixed'),...evidence('five','ambiance','mixed',5)];
 expect(proposal(input)).toEqual(proposal([...input].reverse()));
 const changed=input.map(e=>({...e,jev_native:{...e.jev_native,native_confidence:.99}}));
 expect(proposal(input).selected.map(e=>e.evidence_id)).toEqual(proposal(changed).selected.map(e=>e.evidence_id));
 const small=proposal([...evidence('low','service','negative',2),...evidence('five','ambiance','mixed',5),...positives()]);
 expect(small.selected.filter(e=>e.review_id==='five').map(e=>e.polarity).sort()).toEqual(['negative','positive']);
});

it('remains an unregistered offline proposal and has no network effect',async()=>{
 const deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'));
 try{
  expect(MIXED_SOURCE_COMPLETION_POLICY.production_enabled).toBe(false);
  const pinned=JSON.parse(readFileSync('tests/fixtures/sol-mixed-replay-manifest.json','utf8'));
  const code=readFileSync('experiments/evidence-priority/mixed-source-completion-proposal.ts','utf8').replaceAll('\r\n','\n');
  expect(createHash('sha256').update(code).digest('hex')).toBe(pinned.proposal_function_sha256);
  await expect(evidenceSelectorBinding(MIXED_SOURCE_COMPLETION_POLICY.version)).rejects.toThrow('REPORT_EVIDENCE_SELECTOR_VERSION_INVALID');
  proposal(crowded('mixed'));expect(deny).not.toHaveBeenCalled();
 }finally{deny.mockRestore();}
});
