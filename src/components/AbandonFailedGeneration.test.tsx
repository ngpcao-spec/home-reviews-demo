import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,it,expect,vi} from 'vitest'
import {AbandonFailedGeneration} from './AbandonFailedGeneration'
import type {HistoricalRun} from '../lib/historical-generation'
vi.mock('../i18n',()=>({useI18n:()=>({language:'fr'})}))
const run={status:'failed',request_id:'failed-request',can_abandon:true} as HistoricalRun
afterEach(()=>{cleanup();vi.restoreAllMocks()})
it('requires confirmation, states fresh AI costs, and does not start a new report',async()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false),abandon=vi.fn().mockResolvedValue(true),done=vi.fn()
 render(<AbandonFailedGeneration run={run} abandon={abandon} onAbandoned={done}/>);
 fireEvent.click(screen.getByRole('button'));expect(abandon).not.toHaveBeenCalled()
 confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button'))
 await waitFor(()=>expect(done).toHaveBeenCalledOnce());expect(abandon).toHaveBeenCalledOnce()
 expect(confirm.mock.calls[0][0]).toContain('nouveaux frais IA')
})
it('offers no abandonment for a completed or active report',()=>{
 const {rerender}=render(<AbandonFailedGeneration run={{...run,status:'completed',can_abandon:false}} abandon={vi.fn()} onAbandoned={vi.fn()}/>);
 expect(screen.queryByRole('button')).not.toBeInTheDocument()
 rerender(<AbandonFailedGeneration run={{...run,status:'running',can_abandon:false}} abandon={vi.fn()} onAbandoned={vi.fn()}/>);
 expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
