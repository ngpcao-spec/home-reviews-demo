// Technical mocks only. No supplier, database, credentials, execution or consent.
import {prepareDirectReport,parseDirectReportLuna,directAcceptedSol,validateDirectReport,DIRECT_REPORT_FORMAT} from '../supabase/functions/_shared/jev-direct-report-preparation.ts';
import {DIRECT_CATEGORY_KEYS,directHash} from '../supabase/functions/_shared/jev-direct-categories.ts';
globalThis.fetch=()=>{throw Error('ALL_PROVIDER_NETWORK_FORBIDDEN');};
const [inputPath,outputPath,code]=Deno.args;
if(!inputPath||!outputPath||inputPath===outputPath)throw Error('DISTINCT_PRIVATE_INPUT_OUTPUT_REQUIRED');
const exported=JSON.parse((await Deno.readTextFile(inputPath)).replace(/^\uFEFF/,'')),input=exported.rows?.[0]?.input??exported;
const before=await directHash(input),p=await prepareDirectReport(input,code),checks=[];
for(const assumption of ['supported','unsupported','uncertain'] as const){
 const results=await Promise.all(p.body.luna_groups.map(g=>parseDirectReportLuna(g,{model:'gpt-6-luna',
  usage:{input_tokens:1,output_tokens:0,total_tokens:1},answers:g.evidence_ids.map(name=>({name,type:'choice',choice:assumption,confidence:1,
   probabilities:['supported','unsupported','uncertain'].map(value=>({value,probability:value===assumption?1:0}))}))})));
 const branch=await directAcceptedSol(p,results);
 if(assumption!=='supported'){
  if(branch.gate.passed||branch.draft!==null||branch.accepted.length)throw Error('MOCK_REJECTION_BYPASSED');
  checks.push({assumption,explicit_mock:true,sol_blocked:true});continue;
 }
 if(!branch.gate.passed||!branch.draft)throw Error('MOCK_SUFFICIENCY_FAILED');
 const raw={format_version:DIRECT_REPORT_FORMAT,statistics_sha256:p.body.statistics_sha256,report:{
  categories:DIRECT_CATEGORY_KEYS.map(category=>({category,text:'MÔ PHỎNG KỸ THUẬT — không phải báo cáo nhà cung cấp.',
   evidence_ids:[branch.accepted.find(e=>e.category===category)!.evidence_id]})),positive_aspects:[],negative_aspects:[],
  conclusion:{text:'MÔ PHỎNG KỸ THUẬT.',evidence_ids:[branch.accepted[0].evidence_id]},recommendations:[]}};
 const validated=await validateDirectReport(raw,p,results);
 const replay=await validateDirectReport(raw,p,results);
 if(await directHash(validated)!==await directHash(replay)||await directHash(input)!==before)throw Error('MOCK_REPLAY_OR_SOURCE_CHANGED');
 checks.push({assumption,explicit_mock:true,sol_blocked:false,accepted:branch.accepted.length,
  size:branch.draft.measurement,validated_sha256:await directHash(validated),empty_recommendations_valid:true});
}
const qualification={version:'direct-categories4-report-offline-qualification-v1',preparation_sha256:p.sha256,
 provider_calls:0,provider_network_denied:true,checks,input_unchanged:await directHash(input)===before,
 paid_consent_created:false,paid_run_created:false,semantic_accuracy_measured:false};
await Deno.writeTextFile(outputPath,JSON.stringify(qualification));
const saved=JSON.parse(await Deno.readTextFile(outputPath));
if(await directHash(saved)!==await directHash(qualification))throw Error('MOCK_SAVE_CHANGED');
console.log(JSON.stringify(qualification));
