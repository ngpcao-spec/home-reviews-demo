// @vitest-environment node
import {it,expect} from 'vitest';
import {decimal,independentScore,mean,agrees,type CategoryInputs} from '../../scripts/lib/recommendation-weight-rational';
const inputs=(patch:Partial<CategoryInputs>={}):CategoryInputs=>({rating_sum:'720',rating_count:'150',positive:'60',negative:'15',denominator:'150',classifications_coherent:'true',ratings_coherent:'true',...patch});
it('independently verifies the V1 and V2 equations and exact four-positive compensation',()=>{
 expect(agrees(independentScore(inputs(),2),'5','1')).toBe(true);
 expect(agrees(independentScore(inputs(),4),'4.8','1')).toBe(true);
 expect(agrees(independentScore(inputs({positive:'4',negative:'1'}),4),'4.8','1')).toBe(true);
 expect(agrees(independentScore(inputs({negative:'0'}),4),'5.2','1')).toBe(true);
});
it('handles both clamp limits and missing/zero/incoherent rubric inputs',()=>{
 expect(agrees(independentScore(inputs({rating_sum:'10',rating_count:'10',positive:'0',negative:'10',denominator:'10'}),4),'0','100')).toBe(true);
 expect(agrees(independentScore(inputs({rating_sum:'50',rating_count:'10',positive:'10',negative:'0',denominator:'10'}),4),'6','1')).toBe(true);
 for(const patch of [{rating_sum:null},{denominator:'0'},{rating_count:'0'},{classifications_coherent:'false'}])expect(independentScore(inputs(patch),4)).toBeNull();
});
it('checks non-integer sums and exact global fractions without floating point',()=>{
 const c=independentScore(inputs({rating_sum:'14.4',rating_count:'3',positive:'1',negative:'0',denominator:'3'}),4);
 expect(agrees(c,'46.2','9')).toBe(true);expect(agrees(c,'46.3','9')).toBe(false);
 const scores=['25','20','17.5'].map(sum=>independentScore(inputs({rating_sum:sum,rating_count:'5',positive:'4',negative:'1',denominator:'5'}),4));
 expect(agrees(mean(scores),'12.5','3')).toBe(true);expect(mean([scores[0],scores[1],null])).toBeNull();
 expect(agrees(null,null,null)).toBe(true);expect(agrees(c,null,null)).toBe(false);
 expect(decimal('1.25e-2')).toEqual({n:125n,d:10000n});
});
