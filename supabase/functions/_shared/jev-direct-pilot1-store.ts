// Existing organization RLS, immutable archives, Auth Admin and scheduler authentication are reused.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {assertEvidence40ActiveUser} from './decisions-evidence40-auth.ts';
import {DIRECT_PILOT_ID,DIRECT_PILOT_SOURCE,DIRECT_PILOT_KINDS,type DirectPilotPort,type PilotArchive} from './jev-direct-pilot1.ts';
export function directPilotPort(admin:SupabaseClient):DirectPilotPort{
 let parent:string|null=null,organization:string|null=null;
 const read=async(id:string)=>{const x=await admin.from('analysis_jls_snapshot_preparations').select('*').eq('id',id).single();
  if(x.error||!x.data)throw Error('DIRECT_PILOT_ARCHIVE_MISSING');return x.data as PilotArchive;};
 return {
  load:async id=>{const execution=await read(id),pilot=await read(DIRECT_PILOT_ID),source=await read(DIRECT_PILOT_SOURCE);
   parent=source.protocol_id;organization=source.organization_id;return {execution,pilot,source};},
  assertAuthority:async(userId,org)=>{
   await assertEvidence40ActiveUser(admin,userId);
   const m=await admin.from('organization_members').select('role').eq('user_id',userId).eq('organization_id',org).in('role',['owner','admin','manager']).maybeSingle();
   if(m.error||!m.data||org!==organization)throw Error('FORBIDDEN');
  },
  reserve:async(body,sha)=>{
   if(!parent||!organization)throw Error('DIRECT_PILOT_STORE_SCOPE_MISSING');
   // UNIQUE(protocol_id,kind) is the durable consume-once lock. A conflict never returns the old row.
   const r=await admin.from('analysis_jls_snapshot_preparations').insert({protocol_id:parent,organization_id:organization,
    kind:DIRECT_PILOT_KINDS.attempt,body,sha256:sha}).select('id').single();
   if(r.error?.code==='23505')return null;if(r.error||!r.data)throw Error('DIRECT_PILOT_RESERVATION_UNCONFIRMED');return r.data.id as string;
  },
  save:async(kind,body,sha)=>{
   if(!parent||![DIRECT_PILOT_KINDS.receipt,DIRECT_PILOT_KINDS.result].includes(kind as typeof DIRECT_PILOT_KINDS.receipt))throw Error('DIRECT_PILOT_STORE_SCOPE_MISSING');
   const r=await admin.rpc('save_jls_snapshot_preparation',{p_protocol:parent,p_kind:kind,p_body:body,p_sha:sha});
   if(r.error||typeof r.data!=='string')throw Error('DIRECT_PILOT_SAVE_UNCONFIRMED');return r.data;
  },
 };
}
