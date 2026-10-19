// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {assertEvidence40ActiveUser} from './decisions-evidence40-auth.ts';
import {DIRECT_PILOT_SOURCE,type PilotArchive} from './jev-direct-pilot1.ts';
import {REST79_PREFIX,REST79_PILOT_RESULT,REST79_PILOT_RECEIPT,type Rest79Port} from './jev-direct-rest79.ts';
export function rest79Port(admin:SupabaseClient):Rest79Port{
 let parent:string|null=null,organization:string|null=null;
 const read=async(id:string)=>{const r=await admin.from('analysis_jls_snapshot_preparations').select('*').eq('id',id).single();if(r.error||!r.data)throw Error('REST79_ARCHIVE_MISSING');return r.data as PilotArchive;};
 return {
  load:async id=>{const [execution,source,pilot_result,pilot_receipt]=await Promise.all([read(id),read(DIRECT_PILOT_SOURCE),read(REST79_PILOT_RESULT),read(REST79_PILOT_RECEIPT)]);
   parent=source.protocol_id;organization=source.organization_id;
   const r=await admin.from('analysis_jls_snapshot_preparations').select('*').eq('protocol_id',parent).like('kind',REST79_PREFIX+'%').limit(400);
   if(r.error)throw Error('REST79_DATABASE_FAILED');return {execution,source,pilot_result,pilot_receipt,records:r.data as PilotArchive[]};},
  assertAuthority:async(user,org)=>{await assertEvidence40ActiveUser(admin,user);
   const m=await admin.from('organization_members').select('role').eq('user_id',user).eq('organization_id',org).in('role',['owner','admin','manager']).maybeSingle();
   if(m.error||!m.data||org!==organization)throw Error('FORBIDDEN');},
  reserve:async(kind,body,sha)=>{if(!parent||!organization||!new RegExp('^'+REST79_PREFIX+'attempt_(0[1-9]|[1-6][0-9]|7[0-9])$').test(kind))throw Error('REST79_RESERVATION_SCOPE_INVALID');
   const r=await admin.from('analysis_jls_snapshot_preparations').insert({protocol_id:parent,organization_id:organization,kind,body,sha256:sha}).select('id').single();
   if(r.error?.code==='23505')return null;if(r.error||!r.data)throw Error('REST79_RESERVATION_UNCONFIRMED');return r.data.id as string;},
  save:async(kind,body,sha)=>{if(!parent||!new RegExp('^'+REST79_PREFIX+'(receipt_[0-9]{2}|result_[0-9]{2}|dataset_v1)$').test(kind))throw Error('REST79_SAVE_SCOPE_INVALID');
   const r=await admin.rpc('save_jls_snapshot_preparation',{p_protocol:parent,p_kind:kind,p_body:body,p_sha:sha});if(r.error||typeof r.data!=='string')throw Error('REST79_SAVE_UNCONFIRMED');return r.data;},
  wake:async id=>{const r=await admin.rpc('wake_jev_direct_rest79',{p_execution:id});if(r.error)throw Error('REST79_WAKE_FAILED_NO_PROVIDER_RETRY');},
 };
}
