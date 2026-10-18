// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {assertEvidence40ActiveUser} from './decisions-evidence40-auth.ts';
import {hybridHash} from './jev-hybrid-evidence.ts';
import type {Chill80Port} from './jev-chill80-worker.ts';
export function chill80Port(admin:SupabaseClient):Chill80Port{
 let parent:string|null=null,org:string|null=null,est:string|null=null;
 const rpc=async(name:string,args:Record<string,unknown>)=>{const r=await admin.rpc(name,args);if(r.error)throw Error('CHILL80_RPC_'+name.toUpperCase());return r.data;};
 return {
  load:async id=>{
   const e=await admin.from('analysis_jls_snapshot_preparations').select('*').eq('id',id).eq('kind','jev_chill80_execution_v1').single();if(e.error)throw Error('FORBIDDEN');
   const p=await admin.from('analysis_jls_snapshot_preparations').select('*').eq('id',e.data.body.full_protocol_id).eq('organization_id',e.data.organization_id).single();
   if(p.error||p.data.protocol_id!==e.data.protocol_id||!await rpc('check_jev_chill80',{p_protocol:p.data.id}))throw Error('CHILL80_SOURCE_INCOMPATIBLE');
   await assertEvidence40ActiveUser(admin,p.data.body.authority_user_id);parent=p.data.protocol_id;org=p.data.organization_id;est=p.data.body.establishment_id;
   const r=await admin.from('analysis_jls_snapshot_preparations').select('id,kind,body,sha256').eq('protocol_id',parent).like('kind','jev_chill80_%');if(r.error)throw Error('CHILL80_DATABASE_FAILED');
   return {protocol:{body:p.data.body,sha256:p.data.sha256},protocol_id:p.data.id,execution:e.data,records:r.data};
  },
  baseline:async()=>{const r=await admin.from('analysis_jev_review_cache').select('*').eq('organization_id',org).eq('establishment_id',est).eq('configuration_id','v12_economy_1pass_v1');if(r.error)throw Error('CHILL80_BASELINE_MISSING');return r.data;},
  reserve:(id,review,sha,worker)=>rpc('reserve_jev_chill80',{p_execution:id,p_review:review,p_request_sha:sha,p_worker:worker}),
  save:async(kind,body)=>{if(!parent)throw Error('CHILL80_SCOPE_MISSING');return await rpc('save_jls_snapshot_preparation',{p_protocol:parent,p_kind:kind,p_body:body,p_sha:await hybridHash(body)});},
  wake:async id=>{await rpc('wake_jev_chill80',{p_execution:id});}
 };
}
