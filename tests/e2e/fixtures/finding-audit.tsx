// Synthetic, offline only. No real 30-item selection or saved production labels.
import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {I18nProvider} from '../../../src/i18n'
import {FindingAuditAnnotation,FindingAuditResults} from '../../../src/pages/V9FindingAuditPage'
import {syntheticFindingAudit} from '../../fixtures/v9-finding-audit'
import {compareFindingAudit,type AuditLabel} from '../../../supabase/functions/_shared/v9-finding-audit-core'
import {findingAuditProjection} from '../../../supabase/functions/_shared/v9-finding-audit-api'
import '../../../src/styles/global.css'
import '../../../src/styles/pages.css'
import '../../../src/styles/reference.css'
import '../../../src/styles/warm-theme.css'
const params=new URLSearchParams(location.search),language=params.get('language')==='vi'?'vi':'fr',{bundle,audit,items}=await syntheticFindingAudit()
let labels:AuditLabel[]=JSON.parse(localStorage.getItem('finding-audit-fixture-server')??'[]')
if(params.get('phase')==='results'){labels=items.map((i,n)=>({item_id:i.id,choice:n%3===0?'absent':n%3===1?'both':'uncertain'}));audit.status='completed';audit.comparison=compareFindingAudit(items,labels)}
export function Demo(){const [data,setData]=useState(findingAuditProjection(audit,items,labels,bundle,true)),[busy,setBusy]=useState(false)
  async function action(kind:string,payload:Record<string,unknown>={}){setBusy(true);try{if(kind==='save_choice'){labels=labels.filter(l=>l.item_id!==payload.item_id);labels.push({item_id:payload.item_id,choice:payload.choice} as AuditLabel);localStorage.setItem('finding-audit-fixture-server',JSON.stringify(labels))}else{audit.status='completed';audit.comparison=compareFindingAudit(items,labels)}audit.revision++;setData(findingAuditProjection(audit,items,labels,bundle,true));return true}finally{setBusy(false)}}
  return <main className="page-frame"><div className="jev-page gold-page">{audit.status==='completed'?<FindingAuditResults data={data}/>:<FindingAuditAnnotation data={data} user="synthetic" busy={busy} action={action}/>}</div></main>}
createRoot(document.getElementById('root')!).render(<MemoryRouter><I18nProvider language={language}><Demo/></I18nProvider></MemoryRouter>)
