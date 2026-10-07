import {supabase} from './supabase'
import type {adjudicationProjection} from '../../supabase/functions/_shared/gold-adjudication-api'
export type AdjudicationData=ReturnType<typeof adjudicationProjection>|{eligible:true;adjudication:null;items:[]}
export async function adjudicationApi(id?:string,action?:string,payload:Record<string,unknown>={},summary=false):Promise<AdjudicationData>{
  if(!supabase)throw new Error('UNAUTHORIZED')
  const params=new URLSearchParams({view:summary?'status':'annotation',...(id?{adjudication_id:id}:{})})
  const {data,error}=await supabase.functions.invoke('human-gold-adjudication'+(action?'':'?'+params),action?{body:{adjudication_id:id,action,...payload}}:{method:'GET'})
  if(error){let code='ADJUDICATION_CONNECTION_ERROR';if(error.context instanceof Response){try{code=(await error.context.clone().json()).error??code}catch{/* No transport body exposure. */}}throw new Error(code)}return data as AdjudicationData
}
