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
it('shows batch progress and resumes only the selected experiment without changing normal generation',async()=>{
 const row=parallelPresentationRow('fr');row.current_source_run_id=null;
 const data={routing:{engine:'jev_sol_v2',updated_at:'2026-10-24'},legacy_report:null,
  versions:[{id:row.id,current_source_run_id:null,configuration_version:'jev-multi-review-initial-v1',created_at:'2026-10-24',generated_at:null,state:'running'}],
  experimental:row,run:{id:'batch-run',status:'running',stage:'jev',error_code:null},tasks:[],operation:null,
  batch_progress:{run_id:'batch-run',completed_batches:3,total_batches:11,completed_reviews:150,total_reviews:527,unknown_batches:1,can_resume:true,sol_attempts:0}} satisfies CurrentReportsView;
 mock.invoke.mockResolvedValue({data,error:null});const generate=vi.fn();
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/analyses?variant=legacy&comparison='+row.id]}><I18nProvider language="fr"><CurrentReports establishmentId="est" account="account" languageKey="fr" enabled current={null} generating={false} generationAction={<button onClick={generate}>NORMAL GENERATE</button>}>LEGACY</CurrentReports></I18nProvider></MemoryRouter></QueryClientProvider>);
 await screen.findByText(/3 \/ 11 lots · 150 \/ 527 avis/);
 expect(screen.getByText(/résultat inconnu.*sans renvoi automatique/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Poursuivre les étapes non commencées'}));
 await waitFor(()=>expect(mock.invoke).toHaveBeenCalledWith('jev-batch-experiment',{body:{action:'resume',run_id:'batch-run'}}));
 expect(generate).not.toHaveBeenCalled();
 expect(mock.invoke.mock.calls.every(c=>c[1].body.action!=='start')).toBe(true);
});
it('shows current batch progress and its captured transport after the server option rolls back',async()=>{
 const row=parallelPresentationRow('fr');row.current_source_run_id='source';
 const data={routing:{engine:'jev_sol_v2',jev_transport:'individual',updated_at:'2026-10-24'},current_transport:'batch_initial_v1',legacy_report:null,
  versions:[{id:row.id,current_source_run_id:'source',configuration_version:'jev-multi-review-initial-v1',created_at:'2026-10-24',generated_at:null,state:'running'}],
  experimental:row,run:{id:'current-batches',status:'running',stage:'jev',error_code:null},tasks:[],operation:null,
  batch_progress:{run_id:'current-batches',completed_batches:1,total_batches:2,completed_reviews:50,total_reviews:51,unknown_batches:0,can_resume:true,sol_attempts:0}} satisfies CurrentReportsView;
 mock.invoke.mockResolvedValue({data,error:null});
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/analyses']}><I18nProvider language="fr"><CurrentReports establishmentId="est" account="account" languageKey="fr" enabled current={null} generating={false} generationAction={<button>NORMAL GENERATE</button>}>LEGACY PRESERVED</CurrentReports></I18nProvider></MemoryRouter></QueryClientProvider>);
 expect(await screen.findByText(/1 \/ 2 lots · 50 \/ 51 avis/)).toBeVisible();
 expect(screen.getByText(/Parcours V2 de cette demande : JEV par lots/)).toBeVisible();
 expect(screen.getByRole('button',{name:'NORMAL GENERATE'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Poursuivre les étapes non commencées'}));
 await waitFor(()=>expect(mock.invoke).toHaveBeenCalledWith('jev-batch-experiment',{body:{action:'resume',run_id:'current-batches'}}));
 expect(mock.invoke.mock.calls.every(c=>['read_current','resume'].includes(c[1].body.action))).toBe(true);
 const negative=screen.getAllByRole('button',{name:/Avis négatifs, mixtes inclus/});expect(negative.length).toBeGreaterThan(0);
 fireEvent.click(negative[0]);expect(await screen.findByRole('dialog')).toBeVisible();
});
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

