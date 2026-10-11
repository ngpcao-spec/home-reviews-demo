import {supabase} from './supabase'
import type {EvidenceView} from '../../supabase/functions/_shared/pilot-evidence-api'
export type {EvidenceView}
export async function evidenceApi(language:'fr'|'vi',audit=false):Promise<EvidenceView>{if(!supabase)throw new Error('UNAUTHORIZED');const {data,error}=await supabase.functions.invoke('jev-pilot-evidence?'+new URLSearchParams({language}),audit?{body:{action:'audit_free'}}:{method:'GET'});if(error)throw new Error('EVIDENCE_REQUEST_FAILED');return data as EvidenceView}
