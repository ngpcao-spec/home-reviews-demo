// Synthetic only; never persisted in the live experiment.
import {mockMultiSet,mockMultiReferences} from './luna-multirest.ts';
import {MULTI_SET_ID,MULTI_SEAL_ID,multiLaunchManifest,type MultiLaunchSources,type MultiTask} from '../../supabase/functions/_shared/luna-multirest-launch.ts';
import {decisionsHash} from '../../supabase/functions/_shared/decisions-config.ts';
export async function mockMultiLaunch(){
 const body=await mockMultiSet();body.cases[31].evaluation_eligible=false;body.cases[31].translation_flags=['FROZEN_EN_FIELD_CONTAINS_VIETNAMESE_SENTENCES'];
 for(const c of body.cases){const {case_sha256,...contents}=c;void case_sha256;c.case_sha256=await decisionsHash(contents);}
 body.cases_sha256=await decisionsHash(body.cases);body.eligible_calls=39;body.estimated_input_tokens=19500;body.estimated_cost_usd=.00195;
 const references=await mockMultiReferences(body),sha=await decisionsHash(body),reference_sha256=await decisionsHash(references);
 const source:MultiLaunchSources={record:{id:MULTI_SET_ID,body,body_sha256:sha},seal:{id:MULTI_SEAL_ID,set_id:MULTI_SET_ID,dataset_sha256:sha,reference_sha256,body:references}};
 const manifest=await multiLaunchManifest(source);
 const tasks:MultiTask[]=manifest.cases.map((c,n)=>({id:'mock-task-'+n,run_id:'mock-run',position:c.position,review_id:c.review_id,request_sha256:c.request_sha256,analysis_text_sha256:c.analysis_text_sha256,payload:c.payload,status:'queued',request_count:0,worker_id:null,parsed:null,response:null,response_sha256:null,served_model:null,input_tokens:null,output_tokens:null,cost_usd:null,duration_ms:null,error_code:null}));
 return {source,manifest,tasks,view:{manifest,manifest_sha256:await decisionsHash(manifest),plan_id:null,run:null,tasks:[],api_key_configured:true,can_confirm:true}};
}
