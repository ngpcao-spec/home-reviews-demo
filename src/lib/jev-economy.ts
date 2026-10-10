import {supabase} from './supabase'
import type {EconomyView} from '../../supabase/functions/_shared/jev-economy-api'
export type {EconomyView}
export async function economyApi(id:string):Promise<EconomyView>{if(!supabase)throw new Error('UNAUTHORIZED');const {data,error}=await supabase.functions.invoke('get-jev-economy?'+new URLSearchParams({establishment_id:id}).toString(),{method:'GET'});if(error)throw new Error('ECONOMY_READ_FAILED');return data as EconomyView}
