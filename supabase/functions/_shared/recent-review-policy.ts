import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
export const RECENT_TEXT_POLICY='recent_text_100_6m_v1';
/** Calendar subtraction in the fixed business timezone (UTC+7, no DST). */
export function recentReviewCutoff(asOf=new Date()):string{
 const local=new Date(asOf.getTime()+7*3600000),day=local.getUTCDate();local.setUTCDate(1);local.setUTCMonth(local.getUTCMonth()-6);
 const last=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth()+1,0)).getUTCDate();local.setUTCDate(Math.min(day,last));return new Date(local.getTime()-7*3600000).toISOString();
}
export async function readReviewPolicy(admin:SupabaseClient){const r=await admin.from('review_corpus_policy').select('version,enabled,paused,ingestions_paused,epoch').eq('id',true).single();if(r.error||!r.data)throw Error('REVIEW_POLICY_UNAVAILABLE');return r.data as {version:string;enabled:boolean;paused:boolean;ingestions_paused:boolean;epoch:string};}
export async function assertIngestionAllowed(admin:SupabaseClient){const p=await readReviewPolicy(admin);if(p.paused||p.ingestions_paused)throw Error('RETENTION_INGESTION_PAUSED');return p;}
export async function knownReviewKeys(admin:SupabaseClient,establishment:string,ids:string[]){if(!ids.length)return new Set<string>();const p=await readReviewPolicy(admin);if(!p.enabled)return new Set<string>();const r=await admin.rpc('known_retention_review_ids',{p_establishment:establishment,p_external_ids:ids});if(r.error)throw Error('REVIEW_KEYS_READ_FAILED');return new Set<string>(r.data??[]);}
