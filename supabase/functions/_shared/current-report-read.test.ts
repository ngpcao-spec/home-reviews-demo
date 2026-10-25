import {it,expect} from 'vitest';
import {readCurrentReports} from './current-report-read.ts';
function fixture(preparing=false,abandoned=false){
 const reads:{table:string;filters:Record<string,unknown>}[]=[];
 const versions=[{id:'new-report',current_source_run_id:'new-source',state:'generating',run_id:null,configuration_version:'jev-multi-review-initial-v1'},
  {id:'old-report',current_source_run_id:'old-source',state:'completed',run_id:null,configuration_version:'jev-multi-review-initial-v1'}];
 const db={from:(table:string)=>{const f:Record<string,unknown>={};const q={select:()=>q,order:()=>q,limit:()=>q,in:()=>q,
  eq:(key:string,value:unknown)=>{f[key]=value;return q;},single:async()=>result(),maybeSingle:async()=>result(),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)};
  function result(){reads.push({table,filters:{...f}});const data=table==='establishments'?{id:'est',organization_id:'org'}:table==='organization_members'?{role:'manager'}
   :table==='profiles'?{preferred_language:'vi'}:table==='review_corpus_policy'?{enabled:false,paused:false}:table==='report_pipeline_settings'?{engine:'jev_sol_v2',jev_transport:'batch_initial_v1'}
   :table==='historical_establishment_reports'?null:table==='report_generation_requests'?{id:'new-request',engine:'jev_sol_v2',jev_transport:'batch_initial_v1',source_run_id:'new-source',comparison_id:preparing?null:'new-report'}
   :table==='report_generation_abandonments'?(abandoned?[{request_id:'new-request',source_run_id:'new-source'}]:[])
   :table==='historical_report_runs'?{id:'new-source',generation_id:'new-generation',status:'running',establishment_id:'est',language:'vi',cursor:0,error_code:null}
   :table==='analysis_parallel_reports'?(f.id?{...versions.find(v=>v.id===f.id),source_reviews:[]}:versions)
   :table==='analysis_jev_batch_runs'?{id:f.report_id==='new-report'?'new-batches':'old-batches',stage:'jev',status:f.report_id==='new-report'?'running':'completed',sol_request_count:0,armed:true,expires_at:'2099-01-01T00:00:00Z'}
   :table==='analysis_jev_batch_tasks'?[{status:'completed',reviews:50},{status:f.run_id==='old-batches'?'completed':'pending',reviews:20}]:null;
   return {data,error:null};}return q;}};
 return {context:{client:db,admin:db,user:{id:'user'}} as never,reads};
}
it('returns the available finished report and the newer current request as separate bound objects',async()=>{
 const f=fixture(),r=await readCurrentReports(f.context,{establishment_id:'est'});
 expect(r.experimental).toMatchObject({id:'old-report',current_source_run_id:'old-source',state:'completed'});
 expect(r.request_run).toMatchObject({request_id:'new-request',source_run_id:'new-source',comparison_id:'new-report',batch_run_id:'new-batches',status:'running',progress:1,total_steps:2});
 expect(r.batch_progress?.run_id).toBe('old-batches');
});
it('retains the finished report while a new frozen request has no batch plan yet',async()=>{
 const f=fixture(true),r=await readCurrentReports(f.context,{establishment_id:'est'});
 expect(r.experimental?.id).toBe('old-report');expect(r.request_run).toMatchObject({request_id:'new-request',stage:'preparing',total_steps:null});
});
it('keeps an explicitly selected archive separate from the latest request',async()=>{
 const f=fixture(),r=await readCurrentReports(f.context,{establishment_id:'est',comparison_id:'new-report'});
 expect(r.experimental?.id).toBe('new-report');expect(r.request_run?.request_id).toBe('new-request');
});
it('discards an abandoned partial report from the active view while keeping the completed report',async()=>{
 const f=fixture(false,true),r=await readCurrentReports(f.context,{establishment_id:'est'});
 expect(r.experimental?.id).toBe('old-report');expect(r.request_run).toBeNull();
 expect(r.versions.map(v=>v.id)).toEqual(['old-report']);expect(r.current_transport).toBe('batch_initial_v1');
});
