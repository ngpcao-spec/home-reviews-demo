import {supabase} from './supabase'
import type {findingAuditProjection} from '../../supabase/functions/_shared/v9-finding-audit-api'
export type FindingAuditData=ReturnType<typeof findingAuditProjection>|{eligible:true;audit:null;items:[]}
export async function findingAuditApi(id?:string,action?:string,payload:Record<string,unknown>={},summary=false):Promise<FindingAuditData>{
  if(!supabase)throw new Error('UNAUTHORIZED')
  const params=new URLSearchParams({view:summary?'status':'annotation',...(id?{audit_id:id}:{})})
  const {data,error}=await supabase.functions.invoke('v9-finding-human-audit'+(action?'':'?'+params),action?{body:{audit_id:id,action,...payload}}:{method:'GET'})
  if(error){let code='FINDING_AUDIT_CONNECTION_ERROR';if(error.context instanceof Response){try{code=(await error.context.clone().json()).error??code}catch{/* Never echo transport bodies. */}}throw new Error(code)}return data as FindingAuditData
}
