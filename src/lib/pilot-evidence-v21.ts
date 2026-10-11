import {supabase} from './supabase'
import type {EvidenceV21View} from '../../supabase/functions/_shared/pilot-evidence-v21-api'
export type {EvidenceV21View}
export async function evidenceV21Api(language:'fr'|'vi',audit=false):Promise<EvidenceV21View>{if(!supabase)throw new Error('UNAUTHORIZED');const {data,error}=await supabase.functions.invoke('jev-pilot-evidence-v21?'+new URLSearchParams({language}),audit?{body:{action:'audit_free'}}:{method:'GET'});if(error)throw new Error('EVIDENCE_V21_REQUEST_FAILED');return data as EvidenceV21View}
