// Native four-category Decisions experiment. Reuses the existing durable worker.
import {DIRECT_CONFIG,DIRECT_CATEGORY_KEYS,DIRECT_NATIVE_CHOICES,directHash,directCanonical,type DirectCategory,type DirectCategoryAnswer} from './jev-direct-categories.ts';
import {analysisTextSha256} from './analysis-text.ts';
import {parseDecisionEnvelope,choiceDistribution} from './decisions-config.ts';
import type {RestaurantState,RestaurantExecutionContract} from './jls-restaurant-worker.ts';
import type {RestaurantProtocol} from './jls-restaurant.ts';
export const LUNA_DIRECT4_COMPARE='luna-direct4-classification-comparison-v1';
export const lunaDirect4Questions=()=>DIRECT_CATEGORY_KEYS.map(name=>{
 const q=DIRECT_CONFIG.questions[name];return {name,type:'choice' as const,instructions:q.instructions,
 choices:DIRECT_NATIVE_CHOICES.map(value=>({value,description:q.criteria[value]}))};
});
export interface LunaComparisonItem {
 review_id:string;review_alias:string;analysis_text:string;analysis_text_sha256:string;
 original_text:string;original_text_sha256:string;translation_provenance:unknown;rating:number;
 jev:{task_id:string;artifact_sha256:string;request_sha256:string;served_model:string;usage:unknown;categories:Record<DirectCategory,DirectCategoryAnswer>};
 request_sha256:string;input_json:string;
}
export interface LunaComparisonBody {
 version:typeof LUNA_DIRECT4_COMPARE;organization_id:string;establishment_id:string;authority_user_id:string;
 source_archive_id:string;source_archive_sha256:string;source_protocol_id:string;source_snapshot_sha256:string;
 configuration:{id:string;model:'gpt-6-luna';endpoint:'/v1/decisions';source_jev_configuration_sha256:string;questions:ReturnType<typeof lunaDirect4Questions>;
 confidence_threshold:null;native_choice_without_filter:true;automatic_retry:false};
 configuration_sha256:string;items:LunaComparisonItem[];max_jev_calls:0;max_luna_calls:number;max_sol_calls:0;
 pending:[];production_enabled:false;code_provenance:string;preparation_is_not_spending_authorization:true;
}
export function lunaDirect4Payload(item:Pick<LunaComparisonItem,'review_alias'|'analysis_text'>){
 if(!item.analysis_text.trim()||!item.review_alias.trim())throw Error('LUNA_DIRECT4_TEXT_REQUIRED');
 return {model:'gpt-6-luna',input:JSON.stringify({review_alias:item.review_alias,analysis_text:item.analysis_text}),questions:lunaDirect4Questions()};
}
export async function verifyLunaComparison(p:LunaComparisonBody,sha:string){
 if(p.version!==LUNA_DIRECT4_COMPARE||await directHash(p)!==sha||p.production_enabled!==false||p.max_jev_calls!==0||p.max_sol_calls!==0||
 p.max_luna_calls!==p.items.length||p.items.length!==87||new Set(p.items.map(i=>i.review_id)).size!==87||
 p.configuration.model!=='gpt-6-luna'||p.configuration.endpoint!=='/v1/decisions'||p.configuration.confidence_threshold!==null||
 p.configuration.native_choice_without_filter!==true||p.configuration.automatic_retry!==false||
 p.configuration.source_jev_configuration_sha256!==await directHash(DIRECT_CONFIG)||
 directCanonical(p.configuration.questions)!==directCanonical(lunaDirect4Questions())||await directHash(p.configuration)!==p.configuration_sha256)
 throw Error('LUNA_DIRECT4_PROTOCOL_CHANGED');
 for(const i of p.items)if(await analysisTextSha256(i.analysis_text)!==i.analysis_text_sha256||
 await analysisTextSha256(i.original_text)!==i.original_text_sha256||lunaDirect4Payload(i).input!==i.input_json||await directHash(lunaDirect4Payload(i))!==i.request_sha256)
 throw Error('LUNA_DIRECT4_SOURCE_CHANGED');
}
export function parseLunaDirect4(raw:unknown){
 const e=parseDecisionEnvelope(raw,[...DIRECT_CATEGORY_KEYS]);if(e.model!=='gpt-6-luna')throw Error('LUNA_DIRECT4_MODEL_CHANGED');
 const categories=Object.fromEntries(DIRECT_CATEGORY_KEYS.map(k=>{
  const a=e.answers.get(k)!;
  if(a.type==='refusal')return [k,{native_choice:null,classification:null,status:'refused',probabilities:null,native_confidence:null,raw_answer:a}];
  if(a.type!=='choice')throw Error('LUNA_DIRECT4_CHOICE_REQUIRED');
  const d=choiceDistribution(a,DIRECT_NATIVE_CHOICES),choice=a.choice as typeof DIRECT_NATIVE_CHOICES[number];
  return [k,{native_choice:choice,classification:choice==='uncertain'?null:choice,status:choice==='uncertain'?'uncertain':'classified',
   probabilities:d.values,native_confidence:d.confidence,raw_answer:a}];
 })) as Record<DirectCategory,DirectCategoryAnswer>;
 return {version:'luna-direct4-native-parser-v1',model:e.model,usage:e.usage,categories,confidence_filter_applied:false,raw_response:raw};
}
export function compareLunaDirect4(p:LunaComparisonBody,s:RestaurantState){
 const rows=p.items.flatMap(i=>{
  const t=s.tasks.find(t=>t.phase==='luna'&&t.review_id===i.review_id),a=s.artifacts.find(a=>a.kind==='task:'+t?.id);
  const result=a?.body.native_classification as ReturnType<typeof parseLunaDirect4>|undefined;
  return DIRECT_CATEGORY_KEYS.map(category=>{const jev=i.jev.categories[category],luna=result?.categories[category];
   return {review_id:i.review_id,category,analysis_text:i.analysis_text,analysis_text_sha256:i.analysis_text_sha256,
    original_text:i.original_text,original_text_sha256:i.original_text_sha256,translation_provenance:i.translation_provenance,
    jev_choice:jev.native_choice,luna_choice:luna?.native_choice??null,jev_probabilities:jev.probabilities,luna_probabilities:luna?.probabilities??null,
    jev_confidence:jev.native_confidence,luna_confidence:luna?.native_confidence??null,jev_model:i.jev.served_model,luna_model:result?.model??null,
    task_id:t?.id??null,task_status:t?.status??'unavailable',error:a?.body.error_code??null,
    comparable:!!jev.native_choice&&!!luna?.native_choice,agreement:jev.native_choice&&luna?.native_choice?jev.native_choice===luna.native_choice:null,
    difference_is_not_a_proven_error:true};});
 });
 const counts=Object.fromEntries(DIRECT_CATEGORY_KEYS.map(category=>{
  const rs=rows.filter(r=>r.category===category);
  const count=(model:'jev'|'luna')=>Object.fromEntries([...DIRECT_NATIVE_CHOICES,'unavailable_or_refused'].map(c=>[c,
   rs.filter(r=>c==='unavailable_or_refused'?!r[model+'_choice' as 'jev_choice']:r[model+'_choice' as 'jev_choice']===c).length]));
  const jev=count('jev'),luna=count('luna'),agree=rs.filter(r=>r.agreement===true).length,comparable=rs.filter(r=>r.comparable).length;
  const polar=(x:typeof jev)=>({positive_including_mixed:x.positive+x.mixed,negative_including_mixed:x.negative+x.mixed,
   distinct_mentioned_reviews:x.positive+x.negative+x.mixed+x.neutral});
  return [category,{jev,luna,delta_luna_minus_jev:Object.fromEntries(Object.keys(jev).map(k=>[k,luna[k]-jev[k]])),
   jev_polarities:polar(jev),luna_polarities:polar(luna),agreements:agree,comparable,disagreements:comparable-agree,
   agreement_rate:comparable?agree/comparable:null}];
 }));
 const comparable=rows.filter(r=>r.comparable).length,agreements=rows.filter(r=>r.agreement===true).length;
 return {version:LUNA_DIRECT4_COMPARE,protocol_source_archive_id:p.source_archive_id,rows,counts,
  disagreements:rows.filter(r=>r.agreement===false),total_reviews:p.items.length,total_cells:rows.length,comparable,agreements,
  agreement_rate:comparable?agreements/comparable:null,reviews_with_disagreement:new Set(rows.filter(r=>r.agreement===false).map(r=>r.review_id)).size,
  unavailable_or_refused:rows.filter(r=>!r.comparable),human_reference:false,agreement_is_not_accuracy:true,confidence_filter_applied:false};
}
export function lunaComparisonContract():RestaurantExecutionContract{return {frozenAnalysisSource:true,
 verify:(p,sha)=>verifyLunaComparison(p as unknown as LunaComparisonBody,sha),
 requestWire:(s,t)=>{const p=s.protocol.body as unknown as LunaComparisonBody,i=p.items.find(i=>i.review_id===t.review_id);
  if(t.phase!=='luna'||!i||directCanonical(t.request)!==directCanonical(lunaDirect4Payload(i)))throw Error('LUNA_DIRECT4_REQUEST_CHANGED');
  return JSON.stringify(t.request);},
 parseLuna:async(_s,_t,raw)=>({native_classification:parseLunaDirect4(raw)}),
 completed:async(s,w,port)=>{
  const b=compareLunaDirect4(s.protocol.body as unknown as LunaComparisonBody,s);
  if(!await port.artifact(s.run.id,w,'native_classification_comparison',b,await directHash(b))||
   !await port.stage(s.run.id,w,'completed',[]))throw Error('LUNA_DIRECT4_COMPARISON_SAVE_UNCERTAIN');
 }
};}
// Type adapter only: the durable queue/port remains the existing restaurant worker.
export const asComparisonRestaurant=(p:LunaComparisonBody)=>p as unknown as RestaurantProtocol;
