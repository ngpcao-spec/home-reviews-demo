// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {assertEvidence40ActiveUser} from './decisions-evidence40-auth.ts';
import {hybridHash} from './jev-hybrid-evidence.ts';
import type {Target9Port} from './jev-targeted9-worker.ts';
import type {TargetedProtocol} from './jev-boundaries-targeted-protocol.ts';
export function targeted9Port(admin:SupabaseClient):Target9Port{
 let parent:string|null=null;
 const rpc=async(name:string,args:Record<string,unknown>)=>{const r=await admin.rpc(name,args);if(r.error)throw Error('TARGETED_RPC_'+name.toUpperCase());return r.data;};
 return {
  load:async id=>{
   const e=await admin.from('analysis_jls_snapshot_preparations').select('*').eq('id',id).eq('kind','jev_targeted9_execution_v1').single();
   if(e.error)throw Error('FORBIDDEN');
   const p=await admin.from('analysis_jls_snapshot_preparations').select('*').eq('id',e.data.body.targeted_protocol_id).eq('organization_id',e.data.organization_id).single();
   if(p.error||p.data.protocol_id!==e.data.protocol_id||!await rpc('check_jev_targeted9',{p_protocol:p.data.id}))throw Error('TARGETED_SOURCE_INVALID');
   await assertEvidence40ActiveUser(admin,p.data.body.authority_user_id);parent=p.data.protocol_id;
   const rows=await admin.from('analysis_jls_snapshot_preparations').select('id,kind,body,sha256').eq('protocol_id',parent).like('kind','jev_targeted9_%');
   if(rows.error)throw Error('TARGETED_DATABASE_FAILED');
   return {protocol:{body:p.data.body,sha256:p.data.sha256} as TargetedProtocol,protocol_id:p.data.id,execution:e.data,records:rows.data};
  },
  reserve:(id,review,sha,worker)=>rpc('reserve_jev_targeted9',{p_execution:id,p_review:review,p_request_sha:sha,p_worker:worker}),
  save:async(kind,body)=>{if(!parent)throw Error('TARGETED_SCOPE_MISSING');return await rpc('save_jls_snapshot_preparation',
   {p_protocol:parent,p_kind:kind,p_body:body,p_sha:await hybridHash(body)});},
  wake:async id=>{await rpc('wake_jev_targeted9',{p_execution:id});}
 };
}
