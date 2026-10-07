import {supabase} from './supabase'
import type {runSummary} from '../../supabase/functions/_shared/historical-comparison'
import type {ConsultantReportData} from '../../supabase/functions/_shared/consultant-contract'
export interface V8Status {eligibility?:{available:boolean;source_generation_id?:string|null};run:{generation_id:string;status:string;error_code?:string;progress:number;total_steps:number|null;summary?:ReturnType<typeof runSummary>;report?:ConsultantReportData|null}|null}
export async function historicalV8Api(establishment:string,language:'fr'|'vi',start=false,generation?:string):Promise<V8Status>{
  if(!supabase)throw new Error('UNAUTHORIZED');const params=new URLSearchParams({establishment_id:establishment,preferred_language:language,analysis_version:'8',...(generation?{generation_id:generation}:{})})
  const {data,error}=await supabase.functions.invoke(start?'generate-historical-report':'get-historical-report-status?'+params,start?{body:{establishment_id:establishment,preferred_language:language,first_v8:true}}:{method:'GET'})
  if(error){let code='REPORT_LAUNCH_UNCONFIRMED';if(error.context instanceof Response){try{code=(await error.context.clone().json()).error??code}catch{/* No raw transport output. */}}throw new Error(code)}return data as V8Status
}
