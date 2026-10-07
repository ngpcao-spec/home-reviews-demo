import {supabase} from './supabase'
import type {representativeProjection} from '../../supabase/functions/_shared/representative-api'
export type RepresentativeData=ReturnType<typeof representativeProjection>
export async function representativeApi(id?:string,action?:string,payload:Record<string,unknown>={},summary=false):Promise<RepresentativeData>{
  if(!supabase)throw new Error('UNAUTHORIZED');const params=new URLSearchParams({view:summary?'status':'annotation',...(id?{test_id:id}:{})})
  const {data,error}=await supabase.functions.invoke('representative-human-test'+(action?'':'?'+params),action?{body:{test_id:id,action,...payload}}:{method:'GET'})
  if(error){let code='HOLDOUT_CONNECTION_ERROR';if(error.context instanceof Response){try{code=(await error.context.clone().json()).error??code}catch{/* Do not expose transport bodies. */}}throw new Error(code)}return data as RepresentativeData
}
