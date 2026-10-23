// No mutations, queueing or suppliers. Uses the caller's RLS client.
import type {AuthContext} from './auth.ts';
import {assertMembership} from './auth.ts';
export async function readCurrentReports(c:AuthContext,input:{establishment_id:string;comparison_id?:string}){
 const e=await c.client.from('establishments').select('id,organization_id').eq('id',input.establishment_id).single();if(e.error)throw Error('FORBIDDEN');
 await assertMembership(c.client,c.user.id,e.data.organization_id);
 const profile=await c.client.from('profiles').select('preferred_language').eq('user_id',c.user.id).single();if(profile.error||!['fr','vi'].includes(profile.data.preferred_language))throw Error('PREFERRED_LANGUAGE_REQUIRED');
 const org=e.data.organization_id,language=profile.data.preferred_language;
 const [routing,legacy,versions,request]=await Promise.all([
  c.client.from('report_pipeline_settings').select('engine,updated_at').eq('id',true).single(),
  c.client.from('historical_establishment_reports').select('*').eq('organization_id',org).eq('establishment_id',e.data.id).eq('preferred_language',language).maybeSingle(),
  c.client.from('analysis_parallel_reports').select('id,reference_generation_id,created_at,generated_at,state,run_id,current_source_run_id').eq('organization_id',org).eq('establishment_id',e.data.id).eq('language',language).order('created_at',{ascending:false}),
  c.client.from('report_generation_requests').select('id,source_run_id,comparison_id,engine').eq('organization_id',org).eq('establishment_id',e.data.id).eq('language',language).order('created_at',{ascending:false}).limit(1).maybeSingle()]);
 if(routing.error||legacy.error||versions.error||request.error)throw Error('CURRENT_REPORT_READ_FAILED');
 const versionRuns=versions.data.filter(v=>v.run_id).map(v=>v.run_id);
 if(versionRuns.length){const r=await c.client.from('analysis_jls_restaurant_runs').select('id,status').eq('organization_id',org).in('id',versionRuns);if(r.error)throw Error('CURRENT_REPORT_READ_FAILED');for(const v of versions.data)v.state=r.data.find(r=>r.id===v.run_id)?.status??v.state;}
 const chosen=input.comparison_id??(request.data?.engine==='jev_sol_v2'?request.data.comparison_id:versions.data[0]?.id);
 if(input.comparison_id&&!versions.data.some(v=>v.id===input.comparison_id))throw Error('FORBIDDEN');
 let row=null,run=null,tasks:unknown[]=[],operation=null;
 if(chosen){
  const p=await c.client.from('analysis_parallel_reports').select('*').eq('id',chosen).eq('organization_id',org).eq('establishment_id',e.data.id).single();if(p.error)throw Error('CURRENT_REPORT_READ_FAILED');row=p.data;
  if(row.run_id){const [r,t,o]=await Promise.all([c.client.from('analysis_jls_restaurant_runs').select('id,status,stage,error_code,created_at').eq('id',row.run_id).single(),c.client.from('analysis_jls_restaurant_tasks').select('id,phase,review_id,status,request_count').eq('run_id',row.run_id),c.client.from('analysis_jls_sol_ready_operations').select('id,status,result,receipt,request_count').eq('run_id',row.run_id).maybeSingle()]);if(r.error||t.error||o.error)throw Error('CURRENT_REPORT_READ_FAILED');run=r.data;tasks=t.data;operation=o.data;}
 }else if(request.data?.engine==='jev_sol_v2'){
  const r=await c.admin.from('historical_report_runs').select('id,status,error_code,created_at').eq('id',request.data.source_run_id).eq('organization_id',org).single();if(r.error)throw Error('CURRENT_REPORT_READ_FAILED');run={...r.data,stage:'preparing'};
 }
 return {routing:routing.data,legacy_report:legacy.data,versions:versions.data,experimental:row,run,tasks,operation,provider_calls:0};
}
