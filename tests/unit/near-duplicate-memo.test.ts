import {expect,it} from 'vitest';
import {nearDuplicate,nearDuplicateMemo} from '../../supabase/functions/_shared/pilot-evidence-v3-audit';
it('keeps the frozen comparison result including empty, multilingual and threshold cases',()=>{
 const texts=['','!!!','same same same','same same same!','good food and very friendly staff','good food and friendly staff','not good food',
 'nước uống ngon nhưng đợi lâu','NƯỚC UỐNG NGON nhưng đợi lâu!','Очень вкусная пицца и приятный персонал','직원이 친절해요','料理はおいしいです',
 Array.from({length:20},(_,n)=>'word'+n).join(' '),Array.from({length:19},(_,n)=>'word'+n).join(' ')];
 const memo=nearDuplicateMemo();for(let pass=0;pass<3;pass++)for(const a of texts)for(const b of texts)expect(memo(a,b)).toBe(nearDuplicate(a,b));
});
