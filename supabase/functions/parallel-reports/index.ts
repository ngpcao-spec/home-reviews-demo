import {requireUser,assertMembership} from '../_shared/auth.ts';
import {json,preflight} from '../_shared/cors.ts';
import {parallelProtocol,type ParallelCurrent,type ParallelHistory} from '../_shared/parallel-report.ts';
// POST read is side-effect free. Only an explicit start action can create a run.
Deno.serve(async request=>{
 const early=preflight(request);if(early)return early;
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 try{
  const c=await requireUser(request),body=await request.json();
  if(!['read','start'].includes(body.action)||typeof body.report_id!=='string')return json({error:'INVALID_REQUEST'},400);
  const q=await c.client.from('historical_establishment_reports').select('*').eq('id',body.report_id).single();
  if(q.error||!q.data)throw Error('FORBIDDEN');let report=q.data;
  await assertMembership(c.client,c.user.id,report.organization_id,body.action==='start'?['owner','admin','manager']:undefined);
  const establishment=await c.client.from('establishments').select('organization_id').eq('id',report.establishment_id).single();
  if(establishment.error||establishment.data.organization_id!==report.organization_id)throw Error('FORBIDDEN');
  let archived=null;
  if(body.comparison_id){
   if(body.action!=='read'||typeof body.comparison_id!=='string')throw Error('PARALLEL_ARCHIVE_READ_ONLY');
   const old=await c.client.from('analysis_parallel_reports').select('*').eq('id',body.comparison_id).eq('organization_id',report.organization_id).eq('establishment_id',report.establishment_id).single();
   if(old.error)throw Error('FORBIDDEN');archived=old.data;report=old.data.source_report;
  }
  const history=await c.admin.from('historical_report_runs').select('*').eq('generation_id',report.generation_id).eq('organization_id',report.organization_id).eq('establishment_id',report.establishment_id).eq('status','completed').maybeSingle();
  const pair=archived?{data:archived,error:null}:await c.client.from('analysis_parallel_reports').select('*').eq('reference_report_id',report.id).eq('reference_generation_id',report.generation_id).eq('language',report.preferred_language).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();
  const versions=await c.client.from('analysis_parallel_reports').select('id,reference_generation_id,created_at,generated_at,state,run_id').eq('organization_id',report.organization_id).eq('establishment_id',report.establishment_id).eq('language',report.preferred_language).order('created_at',{ascending:false});
  if(versions.error)throw Error('PARALLEL_READ_FAILED');
  const versionRuns=versions.data.filter(v=>v.run_id).map(v=>v.run_id);
  if(versionRuns.length){const states=await c.client.from('analysis_jls_restaurant_runs').select('id,status').eq('organization_id',report.organization_id).in('id',versionRuns);if(states.error)throw Error('PARALLEL_READ_FAILED');for(const v of versions.data)v.state=states.data.find(r=>r.id===v.run_id)?.status??v.state;}
  if(pair.error||history.error)throw Error('PARALLEL_READ_FAILED');
  const frozen=history.data?.snapshot,sourceRows=frozen?.reviews as Record<string,unknown>[]|undefined;
  const reusable=!!sourceRows?.length&&sourceRows.length===report.stored_reviews_count&&report.ai_status==='completed'&&frozen.base?.source_fingerprint===report.source_fingerprint&&
   new Set(sourceRows.map(r=>r.id)).size===sourceRows.length&&sourceRows.every(r=>typeof r.id==='string'&&typeof r.analysis_text==='string'&&(r.original_text===null||typeof r.original_text==='string')&&
    ['analysis_source','analysis_language','original_language','published_at','review_context','review_detailed_rating'].every(k=>r[k]!==undefined)&&!!String(r.original_text??'').trim()===!!r.analysis_text.trim());
  if(body.action==='start'){
   if(body.confirmed!==true||body.generation_id!==report.generation_id)throw Error('PARALLEL_EXPLICIT_CURRENT_BUTTON_REQUIRED');
   if(!pair.data){
    if(!reusable)throw Error('PARALLEL_CORPUS_UNAVAILABLE');
    const p=await parallelProtocol(report as ParallelCurrent,history.data as ParallelHistory,c.user.id,'86d2130e32387e3982619c1a666bb43c7fac006a');
    if(!p.body.pending.length)throw Error('PARALLEL_NO_TEXT');
    const start=await c.admin.rpc('start_parallel_report',{p_body:p.body,p_sha:p.sha256,p_user:c.user.id});if(start.error)throw Error('PARALLEL_START_REFUSED');
   }
  }
  const row=body.action==='read'?pair:await c.client.from('analysis_parallel_reports').select('*').eq('reference_report_id',report.id).eq('reference_generation_id',report.generation_id).eq('language',report.preferred_language).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).single();
  if(row.error)throw Error('PARALLEL_READ_FAILED');
  let run=null,tasks:unknown[]=[],operation=null;
  if(row.data?.run_id){
   const [r,t,o]=await Promise.all([
    c.client.from('analysis_jls_restaurant_runs').select('id,status,stage,error_code,created_at').eq('id',row.data.run_id).single(),
    c.client.from('analysis_jls_restaurant_tasks').select('id,phase,review_id,status,request_count,completed_at,dispatched_at').eq('run_id',row.data.run_id),
    c.client.from('analysis_jls_sol_ready_operations').select('id,status,result,receipt,request_count').eq('run_id',row.data.run_id).maybeSingle()]);
   if(r.error||t.error||o.error)throw Error('PARALLEL_READ_FAILED');run=r.data;tasks=t.data;operation=o.data;
  }
  const reviews=history.data?.snapshot?.reviews??archived?.source_reviews??[],textual=reviews.filter((r:{analysis_text?:string})=>r.analysis_text?.trim()).length;
  return json({current:{id:report.id,generation_id:report.generation_id,generated_at:report.generated_at,state:report.ai_status,source_reviews:report.stored_reviews_count,text_reviews:textual,source_fingerprint:report.source_fingerprint},
   corpus_reusable:reusable,unavailable_reason:reusable?null:'PARALLEL_CORPUS_UNAVAILABLE',experimental:row.data,run,tasks,operation,
   reference_report:archived?report:null,versions:versions.data,new_provider_calls:0,provider_calls_only_after_explicit_button:true});
 }catch(e){const code=e instanceof Error&&/^[A-Z_0-9]+$/.test(e.message)?e.message:'PARALLEL_REQUEST_FAILED';return json({error:code},code==='UNAUTHORIZED'?401:code==='FORBIDDEN'?403:409);}
});
