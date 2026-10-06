import {supabase} from './supabase'
import type {compareHistoricalRuns,runSummary} from '../../supabase/functions/_shared/historical-comparison'
export interface V7Status {
  run:{generation_id:string;status:string;error_code?:string;progress:number;total_steps:number;summary:ReturnType<typeof runSummary>}|null
  comparison?:ReturnType<typeof compareHistoricalRuns>|null
}
export async function historicalV7Api(establishment:string,language:'fr'|'vi',start=false,generation?:string):Promise<V7Status> {
  if(!supabase)throw new Error('UNAUTHORIZED')
  const params=new URLSearchParams({establishment_id:establishment,preferred_language:language,analysis_version:'7',...(generation?{generation_id:generation}:{})})
  const {data,error}=await supabase.functions.invoke(start?'generate-historical-report':'get-historical-report-status?'+params.toString(),start?{body:{establishment_id:establishment,preferred_language:language,first_v7:true}}:{method:'GET'})
  if(error){let code='REPORT_LAUNCH_UNCONFIRMED';if(error.context instanceof Response){try{code=(await error.context.clone().json()).error??code}catch{/* No raw transport output. */}}throw new Error(code)}
  return data as V7Status
}
