import {expect,it} from 'vitest';
import {DIRECT_CATEGORY_KEYS,DIRECT_CONFIG,DIRECT_NATIVE_CHOICES,directHash} from '../../supabase/functions/_shared/jev-direct-categories';
import {lunaDirect4Payload,lunaDirect4Questions,parseLunaDirect4,compareLunaDirect4,type LunaComparisonBody} from '../../supabase/functions/_shared/luna-direct4-comparison';
const raw=(choice='negative',confidence=.05)=>({model:'gpt-6-luna',usage:{input_tokens:42,output_tokens:0,total_tokens:42},
 answers:DIRECT_CATEGORY_KEYS.map(name=>({name,type:'choice',choice,confidence,
 probabilities:DIRECT_NATIVE_CHOICES.map(value=>({value,probability:value===choice?1:0}))}))});
it('copies all frozen instructions and all six descriptions without semantic changes',async()=>{
 expect(await directHash(DIRECT_CONFIG)).toBe('e5995c6e4b3a8f5949cbcde2531180ad3af503e50ee38b1b7674fceed561fe69');
 for(const q of lunaDirect4Questions()){
  expect(q.instructions).toBe(DIRECT_CONFIG.questions[q.name].instructions);
  expect(q.choices).toEqual(DIRECT_NATIVE_CHOICES.map(value=>({value,description:DIRECT_CONFIG.questions[q.name].criteria[value]})));
 }
});
it('sends the same English text with four questions and no JEV output, rating or source identifiers',()=>{
 const p=lunaDirect4Payload({review_alias:'R1',analysis_text:'Good service.'});
 expect(Object.keys(p)).toEqual(['model','input','questions']);expect(JSON.parse(p.input)).toEqual({review_alias:'R1',analysis_text:'Good service.'});
 expect(p.questions.map(q=>q.name)).toEqual(DIRECT_CATEGORY_KEYS);expect(JSON.stringify(p)).not.toContain('jev_choice');
});
it.each(DIRECT_NATIVE_CHOICES)('preserves the native %s even with low confidence',choice=>{
 const r=raw(choice,0);const before=JSON.stringify(r),p=parseLunaDirect4(r);
 expect(p.confidence_filter_applied).toBe(false);for(const k of DIRECT_CATEGORY_KEYS){expect(p.categories[k].native_choice).toBe(choice);expect(p.categories[k].native_confidence).toBe(0);}
 expect(JSON.stringify(r)).toBe(before);
});
it('keeps refusal separate from uncertainty and maps answers by name',()=>{
 const r=raw('uncertain');r.answers[0]={name:'service',type:'refusal'} as never;r.answers.reverse();
 const p=parseLunaDirect4(r);expect(p.categories.service).toMatchObject({native_choice:null,status:'refused'});
 expect(p.categories.price).toMatchObject({native_choice:'uncertain',status:'uncertain'});
});
it('rejects wrong model, missing questions and non-finite probabilities without manufacturing a classification',()=>{
 expect(()=>parseLunaDirect4({...raw(),model:'other'})).toThrow();const r=raw();r.answers.pop();expect(()=>parseLunaDirect4(r)).toThrow();
 const bad=raw();bad.answers[0].probabilities[0].probability=NaN;expect(()=>parseLunaDirect4(bad)).toThrow();
});
it('compares all four native choices per review, deduplicates mixed and calls differences disagreements',()=>{
 const j=parseLunaDirect4(raw('mixed')),l=parseLunaDirect4(raw('positive'));
 const p={source_archive_id:'source',items:[{review_id:'r1',analysis_text:'English',original_text:'Original',jev:{categories:j.categories,served_model:'jev-1.13.0'}}]} as unknown as LunaComparisonBody;
 const state={tasks:[{id:'task',phase:'luna',review_id:'r1',status:'completed'}],artifacts:[{kind:'task:task',body:{native_classification:l}}]} as never;
 const b=compareLunaDirect4(p,state);expect(b.total_cells).toBe(4);expect(b.reviews_with_disagreement).toBe(1);expect(b.disagreements).toHaveLength(4);
 expect(b.counts.quality).toMatchObject({jev_polarities:{positive_including_mixed:1,negative_including_mixed:1,distinct_mentioned_reviews:1},luna_polarities:{positive_including_mixed:1,negative_including_mixed:0,distinct_mentioned_reviews:1}});
 expect(b.agreement_is_not_accuracy).toBe(true);expect(b.human_reference).toBe(false);expect(b.rows.every(r=>r.difference_is_not_a_proven_error)).toBe(true);
});
