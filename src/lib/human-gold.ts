import {supabase} from './supabase'
import type {blindGoldProjection} from '../../supabase/functions/_shared/gold-api'
export type GoldData=ReturnType<typeof blindGoldProjection>|{eligible:true;gold_set:null;reviews:[]}
export async function goldApi(id?:string,action?:string,payload:Record<string,unknown>={},summary=false):Promise<GoldData> {
  if(!supabase)throw new Error('UNAUTHORIZED')
  const params=new URLSearchParams({view:summary?'status':'annotation',...(id?{gold_set_id:id}:{})})
  const {data,error}=await supabase.functions.invoke('human-gold-set'+(action?'':'?'+params.toString()),action?{body:{gold_set_id:id,action,...payload}}:{method:'GET'})
  if(error){let code='GOLD_CONNECTION_ERROR';if(error.context instanceof Response){try{code=(await error.context.clone().json()).error??code}catch{/* No raw server message. */}}throw new Error(code)}
  return data as GoldData
}
