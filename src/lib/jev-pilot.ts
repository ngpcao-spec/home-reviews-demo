import {supabase} from './supabase'
import type {PilotView} from '../../supabase/functions/_shared/jev-pilot-types'
export type {PilotView}
export async function pilotApi(language:'fr'|'vi',body?:{action:'prepare_snapshot'|'complete_jev'|'generate_sol';confirm_cost?:boolean;source_sha256?:string;input_sha256?:string}):Promise<PilotView>{if(!supabase)throw new Error('UNAUTHORIZED');const {data,error}=await supabase.functions.invoke('jev-economy-pilot?'+new URLSearchParams({language}).toString(),body?{body}:{method:'GET'});if(error){let code='PILOT_CONNECTION_ERROR';if(error.context instanceof Response)try{code=(await error.context.clone().json()).error??code}catch{/* Safe codes only. */}throw new Error(code)}return data as PilotView}
