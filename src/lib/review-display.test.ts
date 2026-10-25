import {afterEach,it,expect,vi} from 'vitest'
import {readReviewDisplay} from './review-display'
const mock=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('./supabase',()=>({supabase:mock}))
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks()})
it('batches and deduplicates visible review IDs across components',async()=>{
 vi.useFakeTimers();mock.rpc.mockResolvedValue({data:[{review_id:'one',language:'vi'},{review_id:'two',language:'vi'}],error:null})
 const pending=[readReviewDisplay('user','vi','one'),readReviewDisplay('user','vi','one'),readReviewDisplay('user','vi','two')];await vi.advanceTimersByTimeAsync(25);expect(await Promise.all(pending)).toHaveLength(3);expect(mock.rpc).toHaveBeenCalledTimes(1);expect(mock.rpc).toHaveBeenCalledWith('read_review_display',{p_reviews:['one','two'],p_prepare:true})
})
it('does not accept a result in the former language when the profile has changed',async()=>{
 mock.rpc.mockResolvedValue({data:[{review_id:'one',language:'vi'}],error:null});await expect(readReviewDisplay('user','fr','one')).rejects.toThrow('DISPLAY_LANGUAGE_CHANGED')
})
