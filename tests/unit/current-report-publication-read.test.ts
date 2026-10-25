import {it,expect,vi} from 'vitest';
import {readCurrentReports} from '../../supabase/functions/_shared/current-report-read';
function context(member=true){
 const publication={row:{id:'dated',current_source_run_id:'deleted-source',state:'completed',source_reviews:[],statistics:{scope:{source_reviews:100}}},scope:{review_count:100,stale:true}};
 const clientReads:string[]=[],adminReads:string[]=[];
 const build=(data:unknown,error:unknown=null)=>{const result={data,error},q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,in:()=>q,single:async()=>result,maybeSingle:async()=>result,then:(resolve:(v:typeof result)=>unknown)=>Promise.resolve(result).then(resolve)};return q;};
 const rows:Record<string,unknown>={establishments:{id:'est',organization_id:'org'},organization_members:member?{role:'owner'}:null,profiles:{preferred_language:'vi'},review_corpus_policy:{enabled:true,version:'recent_text_100_6m_v1'},report_pipeline_settings:{engine:'jev_sol_v2',jev_transport:'batch_initial_v1'},historical_establishment_reports:null,analysis_parallel_reports:[],report_generation_requests:null,review_corpus_states:{retained_count:100}};
 const client={from:(name:string)=>{clientReads.push(name);return build(rows[name]);}},admin={from:(name:string)=>{adminReads.push(name);return build(name==='report_generation_abandonments'?[]:null);},rpc:vi.fn(async(name:string)=>({data:name==='read_current_report_publication'?publication:null,error:null}))};
 return {c:{user:{id:'user'},client,admin},clientReads,adminReads,publication};
}
it('returns a dated report whose source was purged without loading or starting that generation',async()=>{
 const f=context(),deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NO_NETWORK'));
 try{const r=await readCurrentReports(f.c as never,{establishment_id:'est',comparison_id:'untrusted-other-report'});
 expect(r.experimental).toEqual(f.publication.row);expect(r.retention?.scope).toEqual(f.publication.scope);expect(r.run).toBeNull();expect(r.request_run).toBeNull();expect(r.provider_calls).toBe(0);
 expect(f.c.admin.rpc).toHaveBeenCalledWith('read_current_report_publication',{p_establishment:'est',p_language:'vi'});
 expect(f.adminReads).not.toContain('historical_report_runs');expect(f.clientReads).not.toContain('analysis_jev_batch_runs');expect(deny).not.toHaveBeenCalled();
 expect(f.c.admin.rpc.mock.calls.every(([name])=>['read_current_report_publication','read_retired_report_scope'].includes(name))).toBe(true);
 }finally{deny.mockRestore();}
});
it('checks organization membership before reading publication or private source projection',async()=>{
 const f=context(false);await expect(readCurrentReports(f.c as never,{establishment_id:'est'})).rejects.toThrow('FORBIDDEN');expect(f.c.admin.rpc).not.toHaveBeenCalled();expect(f.adminReads).toEqual([]);
});
