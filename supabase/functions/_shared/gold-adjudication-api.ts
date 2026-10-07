import {GOLD_CHOICES,GOLD_KEYS} from './gold-taxonomy.ts'
import {sha256} from './gold-core.ts'
import {ADJUDICATION_GOLD_ID,validateAdjudicationBundle,adjudicationFingerprint,selectAdjudicationItems,compareAdjudication,type AdjudicationBundle,type AdjudicationItem,type AdjudicationLabel} from './gold-adjudication-core.ts'
export interface Adjudication {id:string;gold_set_id:string;organization_id:string;name:string;methodology:string;status:'draft'|'completed';target_reviews:number;revision:number;taxonomy:AdjudicationBundle['gold']['taxonomy'];source_fingerprint:string;comparison:ReturnType<typeof compareAdjudication>|null;created_at:string;completed_at:string|null}
export interface AdjudicationRepository {user:string;loadBundle:()=>Promise<AdjudicationBundle>;get:(id?:string)=>Promise<Adjudication|null>;items:(id:string)=>Promise<AdjudicationItem[]>;labels:(id:string)=>Promise<AdjudicationLabel[]>;create:(payload:Record<string,unknown>)=>Promise<string>;write:(id:string,revision:number,action:string,payload:Record<string,unknown>)=>Promise<void>}
export function adjudicationProjection(a:Adjudication,items:AdjudicationItem[],labels:AdjudicationLabel[],b:AdjudicationBundle,annotation:boolean) {
  return {eligible:true,adjudication:{id:a.id,name:a.name,methodology:a.methodology,status:a.status,target_reviews:a.target_reviews,revision:a.revision,completed_reviews:items.filter(i=>i.themes.every(k=>labels.some(l=>l.review_id===i.review_id&&l.theme_key===k))).length,created_at:a.created_at,completed_at:a.completed_at},taxonomy:a.taxonomy,
    items:annotation?[...items].sort((x,y)=>x.position-y.position).map(item=>({review_id:item.review_id,position:item.position,analysis_text:b.source.snapshot.reviews.find(r=>r.id===item.review_id)!.analysis_text,themes:item.themes,choices:Object.fromEntries(labels.filter(l=>l.review_id===item.review_id).map(l=>[l.theme_key,l.choice]))})):[],
    ...(a.status==='completed'?{comparison:a.comparison}:{})}
}
const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'},json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers})
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)
async function validateItems(items:AdjudicationItem[],b:AdjudicationBundle){
  if(items.length!==12||new Set(items.map(i=>i.review_id)).size!==12)throw new Error('ADJUDICATION_ITEMS_INVALID')
  for(const item of items){const text=b.source.snapshot.reviews.find(r=>r.id===item.review_id)?.analysis_text;if(!text||await sha256(text)!==item.analysis_text_sha256||item.themes.length<1||item.themes.length>3||new Set(item.themes).size!==item.themes.length||item.themes.some(k=>!GOLD_KEYS.includes(k)))throw new Error('ADJUDICATION_TEXT_CHANGED')}
}
export function adjudicationHandler(authenticate:(request:Request)=>Promise<AdjudicationRepository>) {return async(request:Request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers});if(!['GET','POST'].includes(request.method))return json({error:'METHOD_NOT_ALLOWED'},405)
  try{
    const repo=await authenticate(request),params=new URL(request.url).searchParams,body=request.method==='POST'?await request.json():null,id=body?.adjudication_id??params.get('adjudication_id')
    if(id&&!uuid(id))throw new Error('ADJUDICATION_ID_INVALID')
    let a=await repo.get(id??undefined);const b=await repo.loadBundle();await validateAdjudicationBundle(b)
    if(a&&(a.organization_id!==b.gold.organization_id||a.gold_set_id!==ADJUDICATION_GOLD_ID))throw new Error('FORBIDDEN')
    const fingerprint=await adjudicationFingerprint(b);if(a&&a.source_fingerprint!==fingerprint)throw new Error('ADJUDICATION_SOURCE_CHANGED')
    if(request.method==='POST'){
      if(body?.action==='create'){
        if(!a){const selection=await selectAdjudicationItems(b),created=await repo.create({p_user:repo.user,p_gold:ADJUDICATION_GOLD_ID,p_items:selection.items,p_selection:selection.selection,p_fingerprint:fingerprint});a=await repo.get(created)}
      }else{
        if(!a)throw new Error('ADJUDICATION_NOT_FOUND');if(a.status!=='draft')throw new Error('ADJUDICATION_IMMUTABLE');if(!Number.isInteger(body?.revision)||a.revision!==body.revision)throw new Error('ADJUDICATION_REVISION_CHANGED')
        const items=await repo.items(a.id),labels=await repo.labels(a.id);let payload:Record<string,unknown>
        await validateItems(items,b)
        if(body.action==='save_choice'){
          if(!GOLD_CHOICES.includes(body.choice)||!items.some(i=>i.review_id===body.review_id&&i.themes.includes(body.theme_key)))throw new Error('ADJUDICATION_CHOICE_REQUIRED')
          payload={review_id:body.review_id,theme_key:body.theme_key,choice:body.choice}
        }else if(body.action==='finalize'){
          if(body.confirm!==true)throw new Error('ADJUDICATION_CONFIRMATION_REQUIRED');payload={comparison:compareAdjudication(b,items,labels)}
        }else throw new Error('ADJUDICATION_ACTION_INVALID')
        await repo.write(a.id,a.revision,body.action,payload);a=await repo.get(a.id)
      }
    }
    if(!a)return json({eligible:true,adjudication:null,items:[]})
    const [items,labels]=await Promise.all([repo.items(a.id),repo.labels(a.id)])
    await validateItems(items,b)
    return json(adjudicationProjection(a,items,labels,b,request.method==='POST'||params.get('view')==='annotation'))
  }catch(error){const code=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'ADJUDICATION_REQUEST_FAILED';return json({error:code},code==='UNAUTHORIZED'?401:code==='FORBIDDEN'?403:code==='ADJUDICATION_NOT_FOUND'?404:['ADJUDICATION_IMMUTABLE','ADJUDICATION_REVISION_CHANGED','ADJUDICATION_SOURCE_CHANGED'].includes(code)?409:code.startsWith('ADJUDICATION_')?400:500)}
}}
