import {GOLD_CHOICES,GOLD_TAXONOMY} from './gold-taxonomy.ts'
import {AUDIT_V8,AUDIT_V9,AUDIT_TARGET,auditSourceFingerprint,validateAuditSources,validateStoredAuditItems,selectFindingAuditItems,compareFindingAudit,type AuditBundle,type AuditItem,type AuditLabel} from './v9-finding-audit-core.ts'
export interface FindingAudit {id:string;organization_id:string;source_v8_generation_id:string;source_v9_generation_id:string;status:'draft'|'completed';target_findings:number;revision:number;taxonomy:typeof GOLD_TAXONOMY;source_fingerprint:string;comparison:ReturnType<typeof compareFindingAudit>|null;created_at:string;completed_at:string|null}
export interface FindingAuditRepository {user:string;loadBundle:()=>Promise<AuditBundle>;get:(id?:string)=>Promise<FindingAudit|null>;items:(id:string)=>Promise<AuditItem[]>;labels:(id:string)=>Promise<AuditLabel[]>;create:(payload:Record<string,unknown>)=>Promise<string>;write:(id:string,revision:number,action:string,payload:Record<string,unknown>)=>Promise<void>}
export function findingAuditProjection(a:FindingAudit,items:AuditItem[],labels:AuditLabel[],b:AuditBundle,annotation:boolean){
  return {eligible:true,audit:{id:a.id,status:a.status,target_findings:a.target_findings,revision:a.revision,completed_findings:items.filter(i=>labels.some(l=>l.item_id===i.id)).length,created_at:a.created_at,completed_at:a.completed_at},taxonomy:a.taxonomy,
    items:annotation?[...items].sort((x,y)=>x.position-y.position).map(i=>({id:i.id,position:i.position,theme_key:i.theme_key,analysis_text:b.v9.snapshot.reviews.find(r=>r.id===i.review_id)!.analysis_text,choice:labels.find(l=>l.item_id===i.id)?.choice})):[],
    ...(a.status==='completed'?{comparison:a.comparison}:{})}
}
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'},json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers}),uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)
export function findingAuditHandler(authenticate:(request:Request)=>Promise<FindingAuditRepository>){return async(request:Request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers});if(!['GET','POST'].includes(request.method))return json({error:'METHOD_NOT_ALLOWED'},405)
  try{
    const repo=await authenticate(request),body=request.method==='POST'?await request.json():null,params=new URL(request.url).searchParams,id=body?.audit_id??params.get('audit_id')
    if(id&&!uuid(id))throw new Error('FINDING_AUDIT_ID_INVALID')
    let a=await repo.get(id??undefined);const b=await repo.loadBundle();validateAuditSources(b);const fingerprint=await auditSourceFingerprint(b)
    if(a&&(a.organization_id!==b.v9.organization_id||a.source_v8_generation_id!==AUDIT_V8||a.source_v9_generation_id!==AUDIT_V9))throw new Error('FORBIDDEN')
    if(a){
      const taxonomy=a.taxonomy
      // JSONB key order is not significant.
      if(a.source_fingerprint!==fingerprint||Object.keys(taxonomy).length!==25||Object.keys(GOLD_TAXONOMY).some(k=>JSON.stringify(Object.entries(taxonomy[k as keyof typeof GOLD_TAXONOMY]??{}).sort())!==JSON.stringify(Object.entries(GOLD_TAXONOMY[k as keyof typeof GOLD_TAXONOMY]).sort())))throw new Error('FINDING_AUDIT_SOURCE_CHANGED')
    }
    if(request.method==='POST'){
      if(body?.action==='create'){
        if(!a){const selection=await selectFindingAuditItems(b),created=await repo.create({p_user:repo.user,p_items:selection.items,p_selection:selection.selection,p_fingerprint:fingerprint,p_taxonomy:GOLD_TAXONOMY});a=await repo.get(created)}
      }else{
        if(!a)throw new Error('FINDING_AUDIT_NOT_FOUND');if(a.status!=='draft')throw new Error('FINDING_AUDIT_IMMUTABLE');if(!Number.isInteger(body?.revision)||body.revision!==a.revision)throw new Error('FINDING_AUDIT_REVISION_CHANGED')
        const [items,labels]=await Promise.all([repo.items(a.id),repo.labels(a.id)]);await validateStoredAuditItems(items,b)
        let payload:Record<string,unknown>
        if(body?.action==='save_choice'){
          if(!uuid(body.item_id)||!items.some(i=>i.id===body.item_id)||!GOLD_CHOICES.includes(body.choice))throw new Error('FINDING_AUDIT_CHOICE_REQUIRED')
          payload={item_id:body.item_id,choice:body.choice}
        }else if(body?.action==='finalize'){
          if(body.confirm!==true)throw new Error('FINDING_AUDIT_CONFIRMATION_REQUIRED');payload={comparison:compareFindingAudit(items,labels)}
        }else throw new Error('FINDING_AUDIT_ACTION_INVALID')
        await repo.write(a.id,a.revision,body.action,payload);a=await repo.get(a.id)
      }
    }
    if(!a)return json({eligible:true,audit:null,items:[]})
    const [items,labels]=await Promise.all([repo.items(a.id),repo.labels(a.id)]);await validateStoredAuditItems(items,b)
    if(items.length!==AUDIT_TARGET)throw new Error('FINDING_AUDIT_ITEMS_INVALID')
    return json(findingAuditProjection(a,items,labels,b,request.method==='POST'||params.get('view')==='annotation'))
  }catch(e){const code=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'FINDING_AUDIT_REQUEST_FAILED';return json({error:code},code==='UNAUTHORIZED'?401:code==='FORBIDDEN'?403:code==='FINDING_AUDIT_NOT_FOUND'?404:code==='RATE_LIMITED'?429:['FINDING_AUDIT_IMMUTABLE','FINDING_AUDIT_REVISION_CHANGED','FINDING_AUDIT_SOURCE_CHANGED'].includes(code)?409:code.endsWith('_FAILED')?500:code.startsWith('FINDING_AUDIT_')?400:500)}
}}
