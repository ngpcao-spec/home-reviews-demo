import {describe,it,expect,vi} from 'vitest';
import {currentHistoricalStatus} from './current-report-status.ts';
const source={id:'source',establishment_id:'est',language:'vi',generation_id:'generation',status:'running',cursor:0,error_code:null,
 snapshot:{base:{analysis_version:8},reviews:Array.from({length:441},(_,i)=>({id:String(i),rating:5,original_text:'old Sol source',analysis_text:'old Sol source'}))}};
function fixture(options:{published?:boolean;preparing?:boolean;unknown?:boolean;individual?:boolean;foreign?:boolean}={}){
 const reads:{table:string;filters:Record<string,unknown>}[]=[];
 const db={from:(table:string)=>{const filters:Record<string,unknown>={};const query={select:()=>query,eq:(key:string,value:unknown)=>{filters[key]=value;return query;},
  then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(result()).then(resolve),single:async()=>result(),maybeSingle:async()=>result()};
  function result(){reads.push({table,filters:{...filters}});if(Object.values(filters).includes(null))throw Error('NULL_INDIVIDUAL_RUN_LOOKUP');
   const data=table==='report_generation_requests'?{id:'request',engine:'jev_sol_v2',jev_transport:options.individual?'individual':'batch_initial_v1',comparison_id:options.preparing?null:'report',created_at:'2026-10-24T10:00:02Z'}
    :table==='analysis_parallel_reports'?{run_id:options.individual?'individual-run':null,current_source_run_id:options.foreign?'other-source':'source',configuration_version:options.individual?'old-v2':'jev-multi-review-initial-v1',state:options.published?'completed':'generating',error_code:null}
    :table==='analysis_jev_batch_runs'?{id:'batch-run',status:options.published?'completed':'running',stage:options.published?'validate_sol':'sol',completed_at:options.published?'2026-10-24T10:04:54Z':null,error_code:null,sol_request_count:1}
    :table==='analysis_jev_batch_tasks'?Array.from({length:9},(_,i)=>({status:options.unknown&&i===0?'unknown':'completed',reviews:i===8?41:50}))
    :table==='analysis_jls_restaurant_runs'?{stage:'jev'}:[{status:'completed'},{status:'pending'}];return {data,error:null};}
  return query;}};return {db:db as never,reads};
}
describe('normal button status uses the frozen current request transport',()=>{
 it('reads a completed native batch report with null individual run ID and stops loading at 9/9',async()=>{
  const f=fixture({published:true}),status=await currentHistoricalStatus(f.db,source);
  expect(status).toMatchObject({request_id:'request',source_run_id:'source',comparison_id:'report',batch_run_id:'batch-run',status:'completed',stage:'completed',progress:9,total_steps:9,completed_reviews:441,total_reviews:441,progress_unit:'jev_batches'});
  expect(f.reads.some(r=>r.table.startsWith('analysis_jls_'))).toBe(false);expect(JSON.stringify(status)).not.toContain('old Sol source');
 });
 it('does not invent a legacy 24-step plan while the new request is preparing',async()=>{
  const f=fixture({preparing:true});expect(await currentHistoricalStatus(f.db,source)).toMatchObject({stage:'preparing',status:'running',progress:0,total_steps:null});
  expect(f.reads).toHaveLength(1);
 });
 it('keeps JEV 9/9 distinct from the still-running Sol stage',async()=>{
  const f=fixture();expect(await currentHistoricalStatus(f.db,source)).toMatchObject({status:'running',stage:'sol',progress:9,total_steps:9,sol_attempts:1});
 });
 it('keeps unknown batch outcomes visible and never claims or sends anything',async()=>{
  const f=fixture({unknown:true});expect(await currentHistoricalStatus(f.db,source)).toMatchObject({progress:8,total_steps:9,unknown_batches:1});
  expect(f.reads.every(r=>!r.table.includes('provider'))).toBe(true);
 });
 it('keeps the individual transport on its existing task tables',async()=>{
  const f=fixture({individual:true});expect(await currentHistoricalStatus(f.db,source)).toMatchObject({progress:1,total_steps:4,progress_unit:'steps'});
  expect(f.reads.some(r=>r.table==='analysis_jev_batch_runs')).toBe(false);
 });
 it('refuses a displayed report from another current source',async()=>{
  const f=fixture({foreign:true});await expect(currentHistoricalStatus(f.db,source)).rejects.toThrow('REPORT_SOURCE_BINDING_CHANGED');
 });
});
