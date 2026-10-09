import {describe,it,expect,vi,beforeEach} from 'vitest'
import {exploratoryApi} from './jev-exploratory'
const invoke=vi.hoisted(()=>vi.fn())
vi.mock('./supabase',()=>({supabase:{functions:{invoke}}}))
beforeEach(()=>{invoke.mockReset();invoke.mockResolvedValue({data:{run:null},error:null})})
describe('exploratory API boundary',()=>{
 it('untrusted correction JSON cannot switch an import into a paid launch or another run',async()=>{await exploratoryApi('real-run','import',{action:'start',run_id:'other-run',confirm:true,corrections:[]});expect(invoke).toHaveBeenCalledWith('jev-exploratory-review',{body:{action:'import',run_id:'real-run',confirm:true,corrections:[]}})})
 it('reading status uses GET only',async()=>{await exploratoryApi('real-run');expect(invoke).toHaveBeenCalledWith('jev-exploratory-review?id=real-run',{method:'GET'})})
})
