import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {describe,it,expect,vi,afterEach} from 'vitest'
import {I18nProvider} from '../i18n'
import {JevV12Entry,V12Workspace} from './JevV12TestPage'
import {V12_CONFIG} from '../../supabase/functions/_shared/jev-v12-config'
import {syntheticV12} from '../../tests/fixtures/jev-v12'
import type {V12View} from '../lib/jev-v12'
import {restorableRoute} from '../lib/navigation-state'
vi.mock('../lib/supabase',()=>({supabase:null}))
afterEach(cleanup)
async function view():Promise<V12View>{const f=await syntheticV12(),p=f.prepared;return {configuration:{id:V12_CONFIG.question_set,config:V12_CONFIG,config_sha256:p.config_sha256,frozen_at:'2026-10-09'},ready:true,error_code:null,run:null,preview:{source_reviews:32,eligible_reviews:30,source_exclusions:p.source_exclusions,source_invalid_responses:2,rechecks_total:p.rechecks_total,rechecks_applied:p.rechecks_applied,uncertain_labels:1,expected_requests:90,estimated_cost_usd:p.estimated_cost_usd,estimated_input_tokens:p.estimated_input_tokens,input_rate:p.input_rate,prepared_sha256:p.prepared_sha256,dataset_sha256:p.dataset_sha256},comparison:null,progress:{total:0,completed:0,failed:0}}}
const mount=(node:React.ReactNode,language:'fr'|'vi'='fr')=>render(<MemoryRouter><I18nProvider language={language}>{node}</I18nProvider></MemoryRouter>)
describe('manual experimental V12 UI',()=>{
 it('navigates without launching and is restorable on iPad',()=>{mount(<JevV12Entry/>);expect(screen.getByRole('link')).toHaveAttribute('href','/plus/jev-v12-test');expect(restorableRoute('/plus/jev-v12-test')).toBe(true)})
 it('needs manual click plus explicit cost confirmation',async()=>{const start=vi.fn().mockResolvedValue(undefined);mount(<V12Workspace data={await view()} busy={false} start={start}/>);expect(start).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Lancer le test V12'}));expect(start).not.toHaveBeenCalled();expect(screen.getByRole('alertdialog')).toHaveTextContent('USD');fireEvent.click(screen.getByRole('button',{name:'Confirmer le coût et lancer V12'}));await waitFor(()=>expect(start).toHaveBeenCalledTimes(1))})
 it('renders Vietnamese, 30 eligible reviews and frozen settings',async()=>{mount(<V12Workspace data={await view()} busy={false} start={vi.fn()}/>, 'vi');expect(screen.getByRole('button',{name:'Chạy kiểm tra V12'})).toBeInTheDocument();expect(screen.getByRole('heading',{name:'Sẵn sàng'})).toBeInTheDocument();expect(screen.getByText(/themes_v12_semantic_boundaries_v1/)).toBeInTheDocument();expect(screen.getByText('30')).toBeInTheDocument()})
 it('an existing job prevents double launch and exposes server persistence',async()=>{const d=await view();d.run={id:'run',status:'running',error_code:null,created_at:'now'};d.progress={total:90,completed:16,failed:0};mount(<V12Workspace data={d} busy={false} start={vi.fn()}/>);expect(screen.queryByRole('button',{name:'Lancer le test V12'})).not.toBeInTheDocument();expect(screen.getByText(/worker continue côté serveur/)).toBeInTheDocument()})
})
