// Synthetic offline fixture; no real experiment, API or provider request.
import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {I18nProvider} from '../../../src/i18n'
import {ExploratoryWorkspace} from '../../../src/pages/JevExploratoryPage'
import {syntheticNegative,syntheticNegativeTasks,negativeUuid} from '../../fixtures/negative-validation'
import {EXPLORATORY_CONFIG,exploratoryFingerprint,exploratoryPredictions,reviewBundle,validateAiCorrections,type ExploratoryRun,type AiCorrection} from '../../../supabase/functions/_shared/jev-exploratory-core'
import {exploratoryProjection,type AiApproval} from '../../../supabase/functions/_shared/jev-exploratory-api'
import type {ExploratoryData} from '../../../src/lib/jev-exploratory'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/reference.css'
import '../../../src/styles/warm-theme.css'
const language=new URLSearchParams(location.search).get('language')==='vi'?'vi':'fr',h=await syntheticNegative(),tasks=syntheticNegativeTasks(h),items=h.items.slice(0,2).map(i=>({review_id:i.review_id,position:i.position,analysis_text:i.analysis_text!,analysis_text_sha256:i.analysis_text_sha256!,overall_rating:i.overall_rating,normalized_category_ratings:i.normalized_category_ratings,v9:exploratoryPredictions(tasks,i.review_id,'v9'),v11:exploratoryPredictions(tasks,i.review_id,'v11')})),saved=JSON.parse(localStorage.getItem('exploratory-fixture-server')??'null'),run:ExploratoryRun={id:negativeUuid(910),source_id:h.run.id,source_kind:'negative_validation',organization_id:h.run.organization_id,establishment_id:h.run.establishment_id,status:saved?.status??'idle',config:EXPLORATORY_CONFIG,dataset_sha256:await exploratoryFingerprint(items),created_at:'2026-10-09',started_at:null,completed_at:null,rate:.042,error_code:null,locked_by:null};let approvals:AiApproval[]=saved?.approvals??[],corrections:AiCorrection[]=saved?.corrections??[]
const sources=[{id:h.run.id,kind:'negative_validation' as const,organization_id:run.organization_id,establishment_id:run.establishment_id,name:'Artisan · synthetic',ready:2,total:2,reuses_predictions:false}],projection=()=>exploratoryProjection(run,items,sources,approvals,corrections,null)
export function Demo(){const [data,setData]=useState<ExploratoryData>(projection());async function action(kind:string,p:Record<string,unknown>={}){let bundle:Record<string,unknown>|undefined;if(kind==='start')run.status='completed';else if(kind==='approve'){const b=await reviewBundle(run,items,p.review_ids as string[]),a={id:negativeUuid(920),review_ids:p.review_ids as string[],bundle_sha256:b.bundle_sha256,approved_at:'2026-10-09T00:00:00Z',approved_by:'fixture'};approvals=[a];bundle={...b,approval_id:a.id,user_go:true}}else if(kind==='export'){const a=approvals[0];bundle={...await reviewBundle(run,items,a.review_ids),approval_id:a.id,user_go:true}}else if(kind==='import'){corrections=validateAiCorrections(p.corrections,items,approvals[0].review_ids)}localStorage.setItem('exploratory-fixture-server',JSON.stringify({status:run.status,approvals,corrections}));const next={...projection(),...(bundle?{export_bundle:bundle}:{})};setData(next);return next}return <main className="page-frame"><div className="jev-page gold-page exploratory-page"><ExploratoryWorkspace data={data} busy={false} action={action}/></div></main>}
createRoot(document.getElementById('root')!).render(<MemoryRouter><I18nProvider language={language}><Demo/></I18nProvider></MemoryRouter>)
