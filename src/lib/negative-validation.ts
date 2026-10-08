import {supabase} from './supabase'
import type {negativeProjection} from '../../supabase/functions/_shared/negative-validation-api'
export type NegativeData=ReturnType<typeof negativeProjection>
export const ARTISAN_NEGATIVE='252a8dca-14c7-4f09-bd1f-7b2c40ae97aa'
export async function negativeValidationApi(id?:string,action?:string,payload:Record<string,unknown>={},summary=false):Promise<NegativeData>{if(!supabase)throw new Error('UNAUTHORIZED');const params=new URLSearchParams({view:summary?'status':'annotation',...(id?{experiment_id:id}:{})}),{data,error}=await supabase.functions.invoke('negative-review-validation'+(action?'':'?'+params),action?{body:{experiment_id:id,action,...payload}}:{method:'GET'});if(error){let code='NEGATIVE_CONNECTION_ERROR';if(error.context instanceof Response)try{code=(await error.context.clone().json()).error??code}catch{/* No raw transport body. */}throw new Error(code)}return data as NegativeData}
