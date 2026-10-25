// No mutations, queueing or suppliers. Uses the caller's RLS client.
import type {AuthContext} from './auth.ts';
import {assertMembership} from './auth.ts';
import {currentHistoricalStatus} from './current-report-status.ts';
export async function readCurrentReports(c:AuthContext,input:{establishment_id:string;comparison_id?:string}){
 const e=await c.client.from('establishments').select('id,organization_id').eq('id',input.establishment_id).single();if(e.error)throw Error('FORBIDDEN');
 await assertMembership(c.client,c.user.id,e.data.organization_id);
 const profile=await c.client.from('profiles').select('preferred_language').eq('user_id',c.user.id).single();if(profile.error||!['fr','vi'].includes(profile.data.preferred_language))throw Error('PREFERRED_LANGUAGE_REQUIRED');
 const org=e.data.organization_id,language=profile.data.preferred_language;
 const policyRead=await c.client.from('review_corpus_policy').select('version,enabled,paused,epoch').eq('id',true).single();if(policyRead.error)throw Error('REVIEW_POLICY_UNAVAILABLE');
 const policy=policyRead.data;if(policy.enabled)input={establishment_id:input.establishment_id};
 const publication=policy.enabled?await c.admin.rpc('read_current_report_publication',{p_establishment:e.data.id,p_language:language}):{data:null,error:null};
 if(publication.error)throw Error('CURRENT_PUBLICATION_READ_FAILED');
 const [routing,legacy,versions,request,abandoned]=await Promise.all([
  c.client.from('report_pipeline_settings').select('engine,jev_transport,updated_at').eq('id',true).single(),
  c.client.from('historical_establishment_reports').select('*').eq('organization_id',org).eq('establishment_id',e.data.id).eq('preferred_language',language).maybeSingle(),
  c.client.from('analysis_parallel_reports').select('id,reference_generation_id,created_at,generated_at,state,run_id,current_source_run_id,configuration_version').eq('organization_id',org).eq('establishment_id',e.data.id).eq('language',language).order('created_at',{ascending:false}),
  c.client.from('report_generation_requests').select('id,source_run_id,comparison_id,engine,jev_transport').eq('organization_id',org).eq('establishment_id',e.data.id).eq('language',language).order('created_at',{ascending:false}).limit(1).maybeSingle(),
  c.admin.from('report_generation_abandonments').select('request_id,source_run_id').eq('organization_id',org).eq('establishment_id',e.data.id).eq('language',language)]);
 if(routing.error||legacy.error||versions.error||request.error||abandoned.error)throw Error('CURRENT_REPORT_READ_FAILED');
 const discarded=new Set((abandoned.data??[]).map(a=>a.source_run_id));
 versions.data=versions.data.filter(v=>!discarded.has(v.current_source_run_id));
 if(request.data&&discarded.has(request.data.source_run_id))request.data=null;
 const versionRuns=versions.data.filter(v=>v.run_id).map(v=>v.run_id);
 if(versionRuns.length){const r=await c.client.from('analysis_jls_restaurant_runs').select('id,status').eq('organization_id',org).in('id',versionRuns);if(r.error)throw Error('CURRENT_REPORT_READ_FAILED');for(const v of versions.data)v.state=r.data.find(r=>r.id===v.run_id)?.status??v.state;}
 let request_run=null;
 if(request.data?.engine==='jev_sol_v2'){
  const s=await c.admin.from('historical_report_runs').select('id,generation_id,organization_id,establishment_id,language,status,cursor,total_steps,error_code,created_at,completed_at').eq('id',request.data.source_run_id).eq('organization_id',org).single();
  if(s.error)throw Error('CURRENT_REPORT_READ_FAILED');request_run=await currentHistoricalStatus(c.admin,s.data);
 }
 const requested=versions.data.find(v=>v.id===request.data?.comparison_id);
 const available=versions.data.find(v=>v.current_source_run_id&&['completed','needs_review'].includes(v.state));
 const chosen=publication.data?undefined:input.comparison_id??(request.data?.engine==='jev_sol_v2'?
  (requested&&['completed','needs_review'].includes(requested.state)?requested.id:available?.id??requested?.id):
  routing.data.engine==='jev_sol_v2'?available?.id:versions.data.find(v=>v.configuration_version!=='jev-multi-review-initial-v1')?.id);
 if(input.comparison_id&&!versions.data.some(v=>v.id===input.comparison_id))throw Error('FORBIDDEN');
 let row=publication.data?.row??null,run=null,tasks:unknown[]=[],operation=null,batch_progress=null;
 if(chosen){
  const p=await c.client.from('analysis_parallel_reports').select('*').eq('id',chosen).eq('organization_id',org).eq('establishment_id',e.data.id).single();if(p.error)throw Error('CURRENT_REPORT_READ_FAILED');row=p.data;
  if(row.run_id){const [r,t,o]=await Promise.all([c.client.from('analysis_jls_restaurant_runs').select('id,status,stage,error_code,created_at').eq('id',row.run_id).single(),c.client.from('analysis_jls_restaurant_tasks').select('id,phase,review_id,status,request_count').eq('run_id',row.run_id),c.client.from('analysis_jls_sol_ready_operations').select('id,status,result,receipt,request_count').eq('run_id',row.run_id).maybeSingle()]);if(r.error||t.error||o.error)throw Error('CURRENT_REPORT_READ_FAILED');run=r.data;tasks=t.data;operation=o.data;}
  if(row.configuration_version==='jev-multi-review-initial-v1'){
   const b=await c.client.from('analysis_jev_batch_runs').select('id,status,stage,error_code,created_at,sol_request_count,armed,expires_at').eq('report_id',row.id).eq('organization_id',org).single();
   if(b.error)throw Error('BATCH_READ_FAILED');
   const t=await c.client.from('analysis_jev_batch_tasks').select('id,number,reviews,status,request_count').eq('run_id',b.data.id).eq('organization_id',org).order('number');
   if(t.error)throw Error('BATCH_READ_FAILED');run=b.data;
   batch_progress={run_id:b.data.id,completed_batches:t.data.filter(x=>x.status==='completed').length,total_batches:t.data.length,
    completed_reviews:t.data.filter(x=>x.status==='completed').reduce((s,x)=>s+x.reviews,0),total_reviews:t.data.reduce((s,x)=>s+x.reviews,0),
    unknown_batches:t.data.filter(x=>x.status==='unknown').length,can_resume:b.data.status==='running'&&b.data.armed&&Date.parse(b.data.expires_at)>Date.now(),sol_attempts:b.data.sol_request_count};
  }
 }else if(request.data?.engine==='jev_sol_v2'){
  const r=await c.admin.from('historical_report_runs').select('id,status,error_code,created_at').eq('id',request.data.source_run_id).eq('organization_id',org).single();if(r.error)throw Error('CURRENT_REPORT_READ_FAILED');run={...r.data,stage:'preparing'};
 }
 let retention=null;
 if(policy.enabled){const [state,scope,retired]=await Promise.all([
  c.client.from('review_corpus_states').select('*').eq('organization_id',org).eq('establishment_id',e.data.id).maybeSingle(),
  publication.data?Promise.resolve({data:publication.data.scope,error:null}):row?.current_source_run_id?c.client.from('report_corpus_scopes').select('*').eq('organization_id',org).eq('source_run_id',row.current_source_run_id).maybeSingle():Promise.resolve({data:null,error:null}),
  c.admin.rpc('read_retired_report_scope',{p_establishment:e.data.id,p_organization:org,p_language:language})]);
  if(state.error||scope.error||retired.error)throw Error('REVIEW_SCOPE_READ_FAILED');retention={policy,state:state.data,scope:scope.data,retired:retired.data};
 }
 return {retention,routing:routing.data,current_transport:request.data?.jev_transport??routing.data.jev_transport??'individual',request_run,legacy_report:policy.enabled?null:legacy.data,versions:policy.enabled?[]:versions.data,experimental:row,run,tasks,operation,batch_progress,provider_calls:0};
}

