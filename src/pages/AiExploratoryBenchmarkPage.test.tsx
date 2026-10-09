import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {I18nProvider} from '../i18n'
import {describe,it,expect,vi,afterEach} from 'vitest'
import {AiExploratoryBenchmarkEntry,AiBenchmarkWorkspace} from './AiExploratoryBenchmarkPage'
import {restorableRoute} from '../lib/navigation-state'
import type {AiBenchmarkView} from '../lib/ai-exploratory-benchmark'
vi.mock('../lib/supabase',()=>({supabase:null}))
afterEach(cleanup)
const view:AiBenchmarkView={source_experiment_id:'source',run:null,ready:true,eligibility_error:null,english_ready:32,reference_reviews:32,reference_labels:800,reference_models:['chatgpt-fixture'],reference_type:'chatgpt_ai_preannotations',human_validated:false,comparison:null,progress:{total:0,completed:0,failed:0}}
const mount=(node:React.ReactNode,language:'fr'|'vi'='fr')=>render(<MemoryRouter><I18nProvider language={language}>{node}</I18nProvider></MemoryRouter>)
describe('manual AI-reference benchmark',()=>{
 it('entry navigates without creating or launching anything',()=>{mount(<AiExploratoryBenchmarkEntry/>);expect(screen.getByRole('link')).toHaveAttribute('href','/plus/ai-exploratory-benchmark');expect(restorableRoute('/plus/ai-exploratory-benchmark')).toBe(true)})
 it('requires a manual click and paid confirmation, never human finalization',async()=>{const start=vi.fn().mockResolvedValue(undefined);mount(<AiBenchmarkWorkspace data={view} busy={false} start={start} review={vi.fn()}/>);expect(start).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Lancer le benchmark exploratoire V9/V11'}));expect(start).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Confirmer le lancement payant'}));await waitFor(()=>expect(start).toHaveBeenCalledTimes(1));expect(document.body.textContent).not.toContain('Finaliser les annotations humaines');expect(screen.getByRole('heading',{name:'Référence IA ChatGPT — pas un Gold humain'})).toBeInTheDocument()})
 it('incomplete reference blocks launch and Vietnamese is localized',()=>{mount(<AiBenchmarkWorkspace data={{...view,ready:false}} busy={false} start={vi.fn()} review={vi.fn()}/>, 'vi');expect(screen.getByRole('button',{name:'Chạy benchmark khám phá V9/V11'})).toBeDisabled()})
 it('an existing queued job is resumed and has no second paid launch button',()=>{mount(<AiBenchmarkWorkspace data={{...view,run:{id:'id',status:'queued',created_at:'now',error_code:null},progress:{total:192,completed:8,failed:0}}} busy={false} start={vi.fn()} review={vi.fn()}/>);expect(screen.queryByRole('button',{name:'Lancer le benchmark exploratoire V9/V11'})).not.toBeInTheDocument();expect(screen.getByText(/worker continue côté serveur/)).toBeInTheDocument()})
})
