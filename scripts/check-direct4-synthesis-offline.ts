// Private saved data only. This checks preparation and instructions, NOT model quality.
import {DIRECT_SYNTHESIS_VERSION,prepareDirectReport,directAcceptedSol,directEvidenceFlow,parseDirectReportLuna,
 validateDirectReport,DIRECT_REPORT_FORMAT,type DirectReportInput,type DirectReportPreparation,type DirectLunaResult,
 type DirectReportSourceBinding} from '../supabase/functions/_shared/jev-direct-report-preparation.ts';
import {DIRECT_CATEGORY_KEYS,directHash,directCanonical} from '../supabase/functions/_shared/jev-direct-categories.ts';
import {attachPlanTokenMemo,tokenCertificate} from '../supabase/functions/_shared/jls-token-memo.ts';
globalThis.fetch=()=>{throw Error('ALL_PROVIDER_NETWORK_FORBIDDEN');};
const [inputPath,outputPath,commit]=Deno.args;
if(!inputPath||!outputPath||inputPath===outputPath)throw Error('DISTINCT_PRIVATE_INPUT_OUTPUT_REQUIRED');
const cases=JSON.parse(await Deno.readTextFile(inputPath)) as {name:string;input:DirectReportInput;binding?:DirectReportSourceBinding;
 preparation:DirectReportPreparation;results:DirectLunaResult[];report:{categories:{evidence_ids:string[]}[];positive_aspects:{evidence_ids:string[]}[];
 negative_aspects:{evidence_ids:string[]}[];conclusion:{evidence_ids:string[]};recommendations:{evidence_ids:string[]}[]}}[];
const output=[];
for(const c of cases){
 const before=await directHash(c),old=c.preparation;
 const legacy=await prepareDirectReport(c.input,old.body.code_commit,c.binding);
 if(legacy.sha256!==old.sha256)throw Error('OFFLINE_LEGACY_PREPARATION_CHANGED');
 // Real historical Luna verdicts are replayed only against their exact OLD manifest.
 const oldBranch=await directAcceptedSol(old,c.results),refs=[...c.report.categories,...c.report.positive_aspects,
  ...c.report.negative_aspects,c.report.conclusion,...c.report.recommendations].flatMap(x=>x.evidence_ids);
 const historicalFlow=directEvidenceFlow(old.body.selection.candidates,old.body.selection.selected,oldBranch.decisions,refs);
 const next=await prepareDirectReport(c.input,commit,c.binding,DIRECT_SYNTHESIS_VERSION);
 const newFlow=directEvidenceFlow(next.body.selection.candidates,next.body.selection.selected);
 if(directCanonical(next.body.statistics)!==directCanonical(old.body.statistics))throw Error('OFFLINE_STATISTICS_CHANGED');
 // Explicit technical mocks exercise the NEW manifest; never recycle old verdicts onto new questions.
 const mocks=await Promise.all(next.body.luna_groups.map(g=>parseDirectReportLuna(g,{model:'gpt-6-luna',usage:{input_tokens:1,output_tokens:0,total_tokens:1},
  answers:g.evidence_ids.map(name=>({name,type:'choice',choice:'supported',confidence:1,
   probabilities:[{value:'supported',probability:1},{value:'unsupported',probability:0},{value:'uncertain',probability:0}]}))})));
 const memo=await attachPlanTokenMemo(next.body),branch=await directAcceptedSol(next,mocks,memo.count);
 if(!branch.draft)throw Error('MOCK_EVIDENCE_INSUFFICIENT');
 const cert=await tokenCertificate(next.body),sealed=await attachPlanTokenMemo(next.body,cert,true);
 const wire=JSON.stringify(branch.draft.request),packet=branch.draft.packet;
 const raw={format_version:DIRECT_REPORT_FORMAT,statistics_sha256:next.body.statistics_sha256,report:{
  categories:DIRECT_CATEGORY_KEYS.map(category=>({category,text:branch.accepted.some(e=>e.category===category)?'MÔ PHỎNG KỸ THUẬT':'Chưa đủ bằng chứng được chấp nhận cho nhóm này.',
   evidence_ids:branch.accepted.filter(e=>e.category===category).slice(0,1).map(e=>e.evidence_id)})),
  positive_aspects:[],negative_aspects:[],recommendations:[],conclusion:{text:'MÔ PHỎNG KỸ THUẬT',evidence_ids:[branch.accepted[0].evidence_id]}}};
 const simulated=await validateDirectReport(raw,next,mocks,sealed.count,wire);
 if(!simulated.technical_checks_passed||sealed.misses!==0||await directHash(c)!==before||
  !packet.original_reviews?.length||!branch.draft.prompt.includes('strongly positive corpus'))throw Error('OFFLINE_PREPARATION_FAILED');
 output.push({name:c.name,source_sha256:before,synthesis_version:DIRECT_SYNTHESIS_VERSION,preparation_sha256:next.sha256,
  historical_flow:historicalFlow,new_selection_flow:newFlow,statistics_unchanged:true,original_reviews:packet.original_reviews.length,
  questions:next.body.luna_questions,grouped_calls:next.body.max_luna_calls,size:branch.draft.measurement,
  prompt_sha256:next.body.conditional_sol.prompt_sha256,schema_sha256:next.body.conditional_sol.schema_sha256,
  legacy_preparation_unchanged:true,simulated_validation_saved:true,explicit_technical_mocks:true,token_misses:0,input_unchanged:true});
}
const report={version:DIRECT_SYNTHESIS_VERSION,provider_calls:0,consents_created:0,paid_runs_created:0,
 provider_network_forbidden:true,semantic_accuracy_measured:false,checks:output};
await Deno.writeTextFile(outputPath,JSON.stringify(report,null,2));
if(await directHash(JSON.parse(await Deno.readTextFile(outputPath)))!==await directHash(report))throw Error('OFFLINE_SAVE_CHANGED');
console.log(JSON.stringify({version:report.version,provider_calls:0,semantic_accuracy_measured:false,
 checks:output.map(x=>({name:x.name,questions:x.questions,grouped_calls:x.grouped_calls,guarded_tokens:x.size.guarded_input_tokens,
  statistics_unchanged:x.statistics_unchanged,input_unchanged:x.input_unchanged,explicit_technical_mocks:true}))}));
