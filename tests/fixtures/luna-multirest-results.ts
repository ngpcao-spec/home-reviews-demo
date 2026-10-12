// Synthetic fixture for result display. No real labels and no provider calls.
import {mockMultiLaunch} from './luna-multirest-launch';
import {parseMultiDecision} from '../../supabase/functions/_shared/luna-multirest';
import {scoreMultiRun} from '../../supabase/functions/_shared/luna-multirest-launch';
import type {MultiView} from '../../supabase/functions/_shared/luna-multirest-api';
export async function mockMultiCompletedView():Promise<MultiView>{
 const f=await mockMultiLaunch();f.source.seal.body.items[1].choice='absent';
 for(const [n,t] of f.tasks.entries()){const choice=n===0?'unsupported':'supported',raw={model:'gpt-6-luna',answers:[{type:'choice',name:'evidence_support',choice,confidence:n===2?.4:.9,probabilities:[{value:'supported',probability:choice==='supported'?.9:.05},{value:'unsupported',probability:choice==='unsupported'?.9:.05},{value:'uncertain',probability:.05}]}],usage:{input_tokens:500,output_tokens:0,total_tokens:500}};Object.assign(t,{status:'completed',request_count:1,worker_id:'mock-worker',parsed:await parseMultiDecision(raw),input_tokens:500,output_tokens:0,served_model:'gpt-6-luna',cost_usd:.00005,duration_ms:10});}
 const result=scoreMultiRun(f.source,f.tasks);return {record:{...f.source.record,sealed_at:'2026-10-12'},reference_seal:{id:f.source.seal.id,reference_sha256:f.source.seal.reference_sha256,sealed_at:'2026-10-12',body:f.source.seal.body},blind_export:null,result,launch:{...f.view,can_confirm:false,run:{id:'mock-run',status:'completed',manifest_sha256:f.view.manifest_sha256,confirmed_at:'mock',result,result_sha256:'mock'},tasks:f.tasks},paid_enabled:true,can_launch:false,new_paid_calls:0,production_enabled:false};
}
