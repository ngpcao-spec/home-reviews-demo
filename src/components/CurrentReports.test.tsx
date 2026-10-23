import {afterEach,it,expect,vi} from 'vitest'
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {MemoryRouter} from 'react-router-dom'
import {I18nProvider} from '../i18n'
import {CurrentReports,type CurrentReportsView} from './CurrentReports'
import {parallelPresentationRow} from '../../tests/fixtures/parallel-presentation'
const mock=vi.hoisted(()=>({invoke:vi.fn()}));vi.mock('../lib/supabase',()=>({supabase:{functions:{invoke:mock.invoke}}}))
afterEach(()=>{cleanup();mock.invoke.mockReset()})
function draw(language:'fr'|'vi',engine:'jev_sol_v2'|'sol_legacy'='jev_sol_v2',initial='/analyses'){
 const row=parallelPresentationRow(language);row.current_source_run_id='source';
 const data={routing:{engine,updated_at:'2026-10-23'},legacy_report:null,versions:[{id:row.id,current_source_run_id:'source',created_at:'2026-10-23',generated_at:'2026-10-23',state:'completed'}],experimental:row,run:null,tasks:[],operation:null} satisfies CurrentReportsView;
 mock.invoke.mockResolvedValue({data,error:null});const generate=vi.fn();
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[initial]}><I18nProvider language={language}><CurrentReports establishmentId="est" account="account" languageKey={language} enabled current={null} generating={false} generationAction={<button onClick={generate}>NORMAL GENERATE</button>}><p>LEGACY SOL PRESERVED</p></CurrentReports></I18nProvider></MemoryRouter></QueryClientProvider>);return {generate,data}
}
it.each(['fr','vi'] as const)('makes V2 current, preserves archived Sol and never generates on read/tab switch (%s)',async language=>{
 const {generate}=draw(language);await screen.findByRole('tab',{name:language==='fr'?'Rapport courant · V2':'Báo cáo hiện tại · V2'});
 expect(screen.getByRole('button',{name:'NORMAL GENERATE'})).toBeVisible();expect(screen.getByText('LEGACY SOL PRESERVED')).not.toBeVisible();
 expect(mock.invoke.mock.calls.every(c=>c[1].body.action==='read_current')).toBe(true);expect(generate).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('tab',{name:language==='fr'?'Rapports précédents':'Báo cáo trước đây'}));expect(screen.getByText('LEGACY SOL PRESERVED')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'NORMAL GENERATE'}));expect(generate).toHaveBeenCalledTimes(1);
});
it('shows rollback as Sol without launching a second pipeline',async()=>{
 const {generate}=draw('fr','sol_legacy');await screen.findByRole('tab',{name:'Rapport courant · Sol'});expect(screen.getAllByText('LEGACY SOL PRESERVED').some(e=>e.checkVisibility?.()??true)).toBe(true);expect(generate).not.toHaveBeenCalled();
});
it('retains negative/mixed review access and omits generic source links in the current body',async()=>{
 draw('vi');await screen.findByRole('tab',{name:'Báo cáo hiện tại · V2'});
 expect(screen.queryByRole('button',{name:'Xem đánh giá nguồn'})).not.toBeInTheDocument();
 const buttons=screen.getAllByRole('button',{name:/Đánh giá tiêu cực, gồm hỗn hợp/});fireEvent.click(buttons[0]);await screen.findByRole('dialog');fireEvent.click(screen.getByRole('button',{name:'Đóng và quay lại báo cáo'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
