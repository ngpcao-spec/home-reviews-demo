// Read-only compatibility projection for the existing normal generation button.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {historicalRunStatus} from './historical-run-status.ts';
type Run=Parameters<typeof historicalRunStatus>[0]&{id:string};
export async function currentHistoricalStatus(admin:SupabaseClient,run:Run){
 const b=await admin.from('report_generation_requests').select('id,engine,comparison_id').eq('source_run_id',run.id).maybeSingle();if(b.error)throw Error('REPORT_RUN_READ_FAILED');
 if(b.data?.engine!=='jev_sol_v2')return {...historicalRunStatus(run),...(b.data?{request_id:b.data.id,engine:b.data.engine}:{})};
 let stage='preparing',progress=0,total:number|null=null;
 if(b.data.comparison_id){
  const p=await admin.from('analysis_parallel_reports').select('run_id').eq('id',b.data.comparison_id).single();if(p.error)throw Error('REPORT_RUN_READ_FAILED');
  const [r,t]=await Promise.all([admin.from('analysis_jls_restaurant_runs').select('stage').eq('id',p.data.run_id).single(),admin.from('analysis_jls_restaurant_tasks').select('status').eq('run_id',p.data.run_id).eq('phase','jev')]);
  if(r.error||t.error)throw Error('REPORT_RUN_READ_FAILED');stage=r.data.stage;total=t.data.length+2;progress=t.data.filter(t=>['completed','reused'].includes(t.status)).length+(stage==='validate_sol'?1:0);
 }
 return {...historicalRunStatus({...run,total_steps:total,cursor:progress}),request_id:b.data.id,engine:b.data.engine,comparison_id:b.data.comparison_id,stage};
}
