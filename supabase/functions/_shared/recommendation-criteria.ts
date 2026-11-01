import type {Request as EngineRequest,Proposal} from './restaurant-recommendation-engine-v1.ts';
import {shortlistPreferences} from './shortlist-preferences.ts';
import {placeFeatureLabel} from './google-place-taxonomy.ts';
import type {Choice,Fact,Prepared} from './recommendation-ai.ts';
import type {AiExplanation,AiSelection,CriterionCoverage,CriterionState,CautionContext} from './recommendation-ai-contract.ts';
import {decisionDiagnostic,decisionFailure,type DecisionDiagnostic} from './recommendation-diagnostics.ts';

export const CRITERIA_VERSION='recommendation-criteria-coverage-v1';
export type CriterionHint={key:string;label:string;expected:boolean;origin:'optional_text_hint'|'structured_preference'|'mandatory_filter'};
type Criterion={key:string|null;quote:string};
type Evidence={criterion:number;state:CriterionState;refs:string[]};
export type CoverageData={coverage_version:typeof CRITERIA_VERSION;criteria_spans:{key:string|null;start:number;end:number}[];criterion_evidence:Evidence[];caution_refs:string[];alternative_ids:string[]};
const states:CriterionState[]=['documented','partial','contradicted','conflicted','unknown'];
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:string[])=>object(v)&&Object.keys(v).sort().join()===keys.sort().join();
const unique=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string')&&new Set(v).size===v.length;
const point=(f:Fact)=>f.value as {category?:string;status?:string};

export type ReferenceValidationDiagnostic={version:'recommendation-reference-diagnostic-v1';
 location:'reason_refs'|'criterion_evidence.refs'|'caution_refs';
 rule:'invalid_list'|'duplicate_reference'|'empty_list'|'too_many_references'|'reference_not_in_candidate'|'reference_not_allowed_for_reason'|'reference_not_allowed_for_criterion';
 choice_index:number;candidate_index:number;criterion_index:number|null;reference_index:number|null;
 known_reference:string|null;fact_kind:Fact['kind']|null;fact_status:string|null;detail:DecisionDiagnostic};
export class ReferenceValidationError extends Error{
 readonly diagnostic:ReferenceValidationDiagnostic;
 constructor(diagnostic:ReferenceValidationDiagnostic){super('INVALID_REFERENCE');this.name='ReferenceValidationError';this.diagnostic=diagnostic;}
}
/** Receipt-only diagnostics. Never copy an unvalidated model string, request quote,
 * report excerpt or raw response into the error. Unknown references stay unknown. */
function invalidReference(p:Prepared,id:string,choice_index:number,location:ReferenceValidationDiagnostic['location'],rule:ReferenceValidationDiagnostic['rule'],reference_index:number|null=null,ref:unknown=null,criterion_index:number|null=null,list?:unknown,limit?:number):never{
 const f=typeof ref==='string'?p.facts.get(id)?.find(f=>f.ref===ref):undefined;
 const status=f&&['feature','recurrence'].includes(f.kind)?point(f).status:undefined;
 throw new ReferenceValidationError({version:'recommendation-reference-diagnostic-v1',location,rule,choice_index,
  candidate_index:p.candidates.findIndex(c=>c.id===id),criterion_index,reference_index,
  known_reference:f&&/^(?:score_(?:global|quality|service|ambiance)|cuisine|price|freshness|cooking_recurrence|feature_[a-z_]{1,40}|(?:strength|reservation)_(?:quality|service|ambiance|price)_\d{1,4})$/.test(f.ref)?f.ref:null,
  fact_kind:f?.kind??null,fact_status:status&&['reported','denied','conflicted','not_documented','reported_repetition','not_established','unknown'].includes(status)?status:null,
  detail:decisionDiagnostic(p,'INVALID_REFERENCE',location,rule,{candidate_id:id,choice_index,reference_index:reference_index??undefined,reference:ref,criterion_index:criterion_index??undefined,...(list!==undefined?{list,list_limit:limit}:{})})});
}

/** Existing conservative hints create coverage obligations, never new eligibility filters.
 * Arbitrary/uninterpreted free text still reaches the model intact and may add quoted criteria. */
export function criterionHints(query:EngineRequest,text:string,language:'fr'|'vi'):CriterionHint[]{
 const p=shortlistPreferences(query,text),hints:CriterionHint[]=[];
 for(const f of p.features)hints.push({key:'feature_'+f.feature,label:placeFeatureLabel(f.feature,language),expected:f.expected,origin:f.source==='text_hint'?'optional_text_hint':'structured_preference'});
 for(const f of query.required_features??[]){
  const existing=hints.find(h=>h.key==='feature_'+f);
  if(existing){existing.expected=true;existing.origin='mandatory_filter';}
  else hints.push({key:'feature_'+f,label:placeFeatureLabel(f,language),expected:true,origin:'mandatory_filter'});
 }
 for(const c of p.categories)hints.push({key:'category_'+c,label:language==='vi'?({quality:'Chất lượng món ăn',service:'Phục vụ',ambiance:'Không gian'}[c]):({quality:'Qualité des plats',service:'Service',ambiance:'Ambiance'}[c]),expected:true,origin:query.preferences?.categories?.includes(c)?'structured_preference':'optional_text_hint'});
 if(p.avoidRepeatedCooking)hints.push({key:'cooking_recurrence',label:language==='vi'?'Vấn đề nấu nướng lặp lại':'Défauts de cuisson récurrents',expected:false,origin:'optional_text_hint'});
 return hints;
}
export function coverageSchema(ids:string[],hints:CriterionHint[]){
 const evidence={type:'object',additionalProperties:false,required:['criterion','state','refs'],properties:{criterion:{type:'integer',minimum:0,maximum:7},state:{type:'string',enum:states},refs:{type:'array',maxItems:2,items:{type:'string'}}}};
 return {type:'object',additionalProperties:false,required:['criteria','choices'],properties:{
  criteria:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['key','quote'],properties:{key:{type:['string','null'],enum:[...hints.map(h=>h.key),null]},quote:{type:'string',maxLength:500}}}},
  choices:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,required:['id','reason_refs','criterion_evidence','caution_refs','alternative_ids'],properties:{id:{type:'string',enum:ids},reason_refs:{type:'array',minItems:1,maxItems:6,items:{type:'string'}},criterion_evidence:{type:'array',maxItems:8,items:evidence},caution_refs:{type:'array',maxItems:4,items:{type:'string'}},alternative_ids:{type:'array',maxItems:2,items:{type:'string',enum:ids}}}}}
 }};
}
function assessment(key:string,proposal:Proposal,facts:Fact[],hint:CriterionHint):{state:CriterionState;refs:string[]}{
 if(key.startsWith('feature_')){
  const f=proposal.features[key.slice(8)],state:CriterionState=!f?'unknown':f.status==='conflicted'?'conflicted':f.status==='not_documented'?f.citations.length?'partial':'unknown':(f.status==='reported')===hint.expected?'documented':'contradicted';
  return {state,refs:facts.some(f=>f.ref===key)?[key]:[]};
 }
 if(key==='cooking_recurrence'){
  const f=facts.find(f=>f.ref===key);return {state:f&&point(f).status==='reported_repetition'?'contradicted':'unknown',refs:f?[key]:[]};
 }
 const category=key.slice(9),positive=facts.filter(f=>f.kind==='strength'&&point(f).category===category),negative=facts.filter(f=>f.kind==='reservation'&&point(f).category===category);
 return {state:positive.length?negative.length?'partial':'documented':negative.length?'contradicted':'unknown',refs:[positive[0]?.ref,negative[0]?.ref].filter((x):x is string=>!!x)};
}
export function candidateCoverageHints(proposal:Proposal,facts:Fact[],hints:CriterionHint[]){
 return hints.map(h=>({key:h.key,...assessment(h.key,proposal,facts,h),available_refs:facts.filter(f=>permittedForCriterion(f,h.key)).map(f=>f.ref)}));
}
function permittedForCriterion(f:Fact,key:string|null){
 if(key===null)return true;
 if(key.startsWith('feature_'))return f.ref===key;
 if(key==='cooking_recurrence')return f.ref===key;
 return (f.kind==='strength'||f.kind==='reservation')&&point(f).category===key.slice(9);
}
function cautionContext(f:Fact,p:Prepared,id:string,criteria:Criterion[],evidence:Evidence[]):CautionContext|null{
 if(f.kind==='freshness')return (f.value as {state:string}).state==='corpus_changed'?{kind:'freshness',criterion_keys:[]}:null;
 if(!criteria.length)return f.kind==='reservation'?{kind:'documented_issue',criterion_keys:[]}:null;
 const proposal=p.proposals.find(x=>x.establishment_id===id)!;
 for(const [i,c]of criteria.entries()){
  const e=evidence[i];if(!c.key||!e||e.state==='documented')continue;
  // Only the already validated evidence of a known criterion can bind a caution.
  // A category label or a model's unsupported relevance assertion is insufficient.
  if(e.refs.includes(f.ref)&&f.kind!=='strength')return {kind:e.state==='unknown'?'uncertainty':e.state==='partial'?'context_limit':'documented_issue',criterion_keys:[c.key]};
  if(f.kind==='reservation'&&c.key==='category_'+point(f).category)return {kind:'documented_issue',criterion_keys:[c.key]};
  // A positive report point may itself contain a temporal qualification. Match its
  // exact report/section/index to the criterion's reconciled feature citations.
  if(c.key.startsWith('feature_')&&e.state==='partial'&&(f.kind==='strength'||f.kind==='reservation')){
   const sources=Array.isArray(f.source)?f.source as {report_id:string;section:string;index:number}[]:[];
   if(proposal.features[c.key.slice(8)]?.citations.some(c=>sources.some(s=>s.report_id===c.report_id&&s.section===c.section&&s.index===c.index)))return {kind:'context_limit',criterion_keys:[c.key]};
  }
 }
 return null;
}
/** No free explanation is accepted. Quotes must come verbatim from the request; only
 * their offsets are persisted. Source references cannot cross restaurant/corpus boundaries. */
export function validateCoveredDecision(raw:unknown,p:Prepared):Choice[]{
 if(!exact(raw,['criteria','choices']))decisionFailure(p,'INVALID_SELECTION','decision','unexpected_root_shape');
 const v=raw as {criteria:Criterion[];choices:{id:string;reason_refs:string[];criterion_evidence:Evidence[];caution_refs:string[];alternative_ids:string[]}[]};
 if(!Array.isArray(v.criteria)||v.criteria.length>8||!Array.isArray(v.choices)||v.choices.length>3||!v.choices.length&&p.candidates.length)decisionFailure(p,'INVALID_SELECTION',!Array.isArray(v.criteria)||v.criteria.length>8?'criteria':'choices',!Array.isArray(v.criteria)||!Array.isArray(v.choices)?'not_an_array':v.criteria.length>8||v.choices.length>3?'too_many_items':'empty_choices',{list:!Array.isArray(v.criteria)||v.criteria.length>8?v.criteria:v.choices,list_limit:!Array.isArray(v.criteria)||v.criteria.length>8?8:3});
 const hintKeys=p.criteriaHints.map(h=>h.key),keys:string[]=[],spans:CoverageData['criteria_spans']=[];
 for(const [criterionIndex,c]of v.criteria.entries()){
  if(!exact(c,['key','quote'])||typeof c.quote!=='string'||c.quote.length>500||c.key!==null&&!hintKeys.includes(c.key)||!c.quote&&c.key===null)decisionFailure(p,'INVALID_CRITERION','criteria',!exact(c,['key','quote'])?'unexpected_criterion_shape':typeof c.quote!=='string'?'quote_not_string':c.quote.length>500?'quote_too_long':c.key!==null&&!hintKeys.includes(c.key)?'unknown_criterion_key':'empty_open_criterion',{criterion_index:criterionIndex});
  const start=c.quote?p.naturalLanguageRequest.indexOf(c.quote):0;
  if(start<0||!c.quote&&p.criteriaHints.find(h=>h.key===c.key)?.origin==='optional_text_hint')decisionFailure(p,'INVALID_CRITERION','criteria.quote',start<0?'quote_not_in_request':'empty_optional_quote',{criterion_index:criterionIndex});
  const hint=p.criteriaHints.find(h=>h.key===c.key);
  if(hint?.origin==='optional_text_hint'&&!criterionHints({geography:'not_requested'},c.quote,p.proposals[0]?.report.language==='vi'?'vi':'fr').some(h=>h.key===hint.key&&h.expected===hint.expected))decisionFailure(p,'INVALID_CRITERION','criteria.quote','quote_scope_or_negation_mismatch',{criterion_index:criterionIndex});
  if(c.key!==null){if(keys.includes(c.key))decisionFailure(p,'INVALID_CRITERION','criteria.key','duplicate_criterion_key',{criterion_index:criterionIndex});keys.push(c.key);}
  if(spans.some(s=>(s.key===c.key||s.key===null||c.key===null)&&s.start===start&&s.end===start+c.quote.length))decisionFailure(p,'INVALID_CRITERION','criteria.quote','duplicate_criterion_span',{criterion_index:criterionIndex});
  spans.push({key:c.key,start,end:start+c.quote.length});
 }
 if(hintKeys.some(k=>!keys.includes(k))||p.naturalLanguageRequest&&!v.criteria.length)decisionFailure(p,'MISSING_CRITERION','criteria','required_criterion_missing');
 const seen=new Set<string>();
 for(const [choiceIndex,c]of v.choices.entries()){
  if(!exact(c,['id','reason_refs','criterion_evidence','caution_refs','alternative_ids'])||typeof c.id!=='string'||seen.has(c.id)||!p.facts.has(c.id))decisionFailure(p,'INVALID_SELECTION','choices',!exact(c,['id','reason_refs','criterion_evidence','caution_refs','alternative_ids'])?'unexpected_choice_shape':typeof c.id!=='string'?'candidate_id_not_string':seen.has(c.id)?'duplicate_candidate':'candidate_not_transmitted',{choice_index:choiceIndex,candidate_id:c?.id});
  seen.add(c.id);const facts=p.facts.get(c.id)!,proposal=p.proposals.find(x=>x.establishment_id===c.id)!;
  if(!Array.isArray(c.reason_refs)||c.reason_refs.some(r=>typeof r!=='string'))invalidReference(p,c.id,choiceIndex,'reason_refs','invalid_list',null,null,null,c.reason_refs,6);
  if(new Set(c.reason_refs).size!==c.reason_refs.length){const i=c.reason_refs.findIndex((r,i)=>c.reason_refs.indexOf(r)!==i);invalidReference(p,c.id,choiceIndex,'reason_refs','duplicate_reference',i,c.reason_refs[i],null,c.reason_refs,6);}
  if(!c.reason_refs.length)invalidReference(p,c.id,choiceIndex,'reason_refs','empty_list',null,null,null,c.reason_refs,6);
  if(c.reason_refs.length>6)invalidReference(p,c.id,choiceIndex,'reason_refs','too_many_references',null,null,null,c.reason_refs,6);
  const badReason=c.reason_refs.findIndex(r=>!facts.some(f=>f.ref===r&&(['score','cuisine','price','strength'].includes(f.kind)||f.kind==='feature'&&['reported','denied'].includes(point(f).status??''))));
  if(badReason>=0)invalidReference(p,c.id,choiceIndex,'reason_refs',facts.some(f=>f.ref===c.reason_refs[badReason])?'reference_not_allowed_for_reason':'reference_not_in_candidate',badReason,c.reason_refs[badReason]);
  if(!Array.isArray(c.criterion_evidence)||c.criterion_evidence.length!==v.criteria.length||!unique(c.caution_refs)||c.caution_refs.length>4||!unique(c.alternative_ids)||c.alternative_ids.length>2){
   const field=!Array.isArray(c.criterion_evidence)||c.criterion_evidence.length!==v.criteria.length?'criterion_evidence':!unique(c.caution_refs)||c.caution_refs.length>4?'caution_refs':'alternative_ids',list=c[field],limit=field==='criterion_evidence'?v.criteria.length:field==='caution_refs'?4:2;
   decisionFailure(p,'MISSING_CRITERION',field,!Array.isArray(list)?'not_an_array':field==='criterion_evidence'?'criterion_count_mismatch':list.some(x=>typeof x!=='string')?'non_string_item':new Set<unknown>(list).size!==list.length?'duplicate_item':'too_many_items',{choice_index:choiceIndex,candidate_id:c.id,list,list_limit:limit});
  }
  for(const [i,e]of c.criterion_evidence.entries()){
   if(!exact(e,['criterion','state','refs'])||e.criterion!==i||!states.includes(e.state)||!unique(e.refs)||e.refs.length>2)decisionFailure(p,'INVALID_CRITERION_EVIDENCE','criterion_evidence',!exact(e,['criterion','state','refs'])?'unexpected_evidence_shape':e.criterion!==i?'criterion_order_mismatch':!states.includes(e.state)?'unknown_evidence_state':!Array.isArray(e.refs)?'refs_not_array':e.refs.some(x=>typeof x!=='string')?'non_string_reference':new Set(e.refs).size!==e.refs.length?'duplicate_reference':'too_many_references',{choice_index:choiceIndex,candidate_id:c.id,criterion_index:i,list:e?.refs,list_limit:2});
   const key=v.criteria[i].key,selected=e.refs.map(r=>facts.find(f=>f.ref===r));
   const badEvidence=selected.findIndex(f=>!f||!permittedForCriterion(f,key));
   if(badEvidence>=0)invalidReference(p,c.id,choiceIndex,'criterion_evidence.refs',selected[badEvidence]?'reference_not_allowed_for_criterion':'reference_not_in_candidate',badEvidence,e.refs[badEvidence],i);
   if(key!==null){
    const expected=assessment(key,proposal,facts,p.criteriaHints.find(h=>h.key===key)!);
    if(e.state!==expected.state)decisionFailure(p,'INVALID_CRITERION_EVIDENCE','criterion_evidence.state','state_not_supported_by_facts',{choice_index:choiceIndex,candidate_id:c.id,criterion_index:i,expected_state:expected.state,received_state:e.state});
    if(key.startsWith('category_')){
     const positive=selected.some(f=>f?.kind==='strength'),negative=selected.some(f=>f?.kind==='reservation');
     if(e.state==='documented'&&!positive||e.state==='contradicted'&&!negative||e.state==='partial'&&(!positive||!negative)||e.state==='unknown'&&e.refs.length)decisionFailure(p,'INVALID_CRITERION_EVIDENCE','criterion_evidence.refs',e.state==='documented'?'positive_source_missing':e.state==='contradicted'?'negative_source_missing':e.state==='partial'?'mixed_sources_incomplete':'unknown_category_with_references',{choice_index:choiceIndex,candidate_id:c.id,criterion_index:i,list:e.refs,list_limit:2});
    }else if(expected.refs.some(r=>!e.refs.includes(r)))decisionFailure(p,'INVALID_CRITERION_EVIDENCE','criterion_evidence.refs','canonical_reference_missing',{choice_index:choiceIndex,candidate_id:c.id,criterion_index:i,reference:expected.refs.find(r=>!e.refs.includes(r)),list:e.refs,list_limit:2});
   }else{
    // For open-ended needs, validate provenance/polarity rather than pretending a lexical
    // classifier can prove semantic relevance. Display remains an attributed source, not free prose.
    const positive=selected.some(f=>f&&['strength','cuisine','price','freshness'].includes(f.kind)||f?.kind==='feature'&&['reported','denied'].includes(point(f).status??''));
    const negative=selected.some(f=>f?.kind==='reservation'||f?.kind==='feature'&&['denied','reported'].includes(point(f).status??''));
    if(e.state==='documented'&&!positive||e.state==='contradicted'&&!negative||e.state==='partial'&&!selected.length||e.state==='conflicted'&&!selected.some(f=>f?.kind==='feature'&&point(f).status==='conflicted'))decisionFailure(p,'INVALID_CRITERION_EVIDENCE','criterion_evidence.refs','open_criterion_evidence_missing',{choice_index:choiceIndex,candidate_id:c.id,criterion_index:i,list:e.refs,list_limit:2});
   }
  }
  for(const [referenceIndex,r]of c.caution_refs.entries()){
   const f=facts.find(f=>f.ref===r);if(!f)invalidReference(p,c.id,choiceIndex,'caution_refs','reference_not_in_candidate',referenceIndex,r);
   if(!cautionContext(f,p,c.id,v.criteria,c.criterion_evidence))decisionFailure(p,'IRRELEVANT_CAUTION','caution_refs','reference_not_bound_to_requested_criterion',{choice_index:choiceIndex,candidate_id:c.id,reference_index:referenceIndex,reference:r});
  }
 }
 const alternatives=[...new Set(v.choices.flatMap(c=>c.alternative_ids))];
 if(alternatives.length>2||alternatives.some(id=>seen.has(id)||!p.facts.has(id)))decisionFailure(p,'INVALID_ALTERNATIVE','alternative_ids',alternatives.length>2?'too_many_distinct_alternatives':alternatives.some(id=>seen.has(id))?'alternative_already_selected':'alternative_not_transmitted',{candidate_id:alternatives.find(id=>seen.has(id)||!p.facts.has(id)),list:alternatives,list_limit:2});
 let comparisonNeeded=false,comparisonProvided=false;
 for(const h of p.criteriaHints){
  const selectedMatches=v.choices.some(c=>assessment(h.key,p.proposals.find(x=>x.establishment_id===c.id)!,p.facts.get(c.id)!,h).state==='documented');
  const better=p.proposals.filter(x=>!seen.has(x.establishment_id)&&assessment(h.key,x,p.facts.get(x.establishment_id)!,h).state==='documented');
  if(!selectedMatches&&better.length){comparisonNeeded=true;if(alternatives.some(id=>better.some(x=>x.establishment_id===id)))comparisonProvided=true;}
 }
 if(comparisonNeeded&&!comparisonProvided)decisionFailure(p,'MISSING_TRADEOFF','alternative_ids','documented_alternative_not_compared');
 return v.choices.map(c=>({id:c.id,reason_refs:c.reason_refs,caution_ref:c.caution_refs[0]??null,
  coverage_version:CRITERIA_VERSION,criteria_spans:spans,criterion_evidence:c.criterion_evidence,caution_refs:c.caution_refs,alternative_ids:c.alternative_ids}));
}
export function restoreCoveredChoices(choices:Choice[],p:Prepared):Choice[]{
 if(!Array.isArray(choices)||choices.some(c=>c.coverage_version!==CRITERIA_VERSION||!Array.isArray(c.criteria_spans))||!choices[0])throw Error('CACHE_INCOMPATIBLE');
 const spans=choices[0].criteria_spans!;
 if(spans.some(s=>!Number.isInteger(s.start)||!Number.isInteger(s.end)||s.start<0||s.end<s.start||s.end>p.naturalLanguageRequest.length)||choices.some(c=>JSON.stringify(c.criteria_spans)!==JSON.stringify(spans)))throw Error('CACHE_INCOMPATIBLE');
 const restored=validateCoveredDecision({criteria:spans.map(s=>({key:s.key,quote:p.naturalLanguageRequest.slice(s.start,s.end)})),choices:choices.map(c=>({id:c.id,reason_refs:c.reason_refs,criterion_evidence:c.criterion_evidence,caution_refs:c.caution_refs,alternative_ids:c.alternative_ids}))},p);
 if(choices.some((c,i)=>!exact(c,['id','reason_refs','caution_ref','coverage_version','criteria_spans','criterion_evidence','caution_refs','alternative_ids'])||JSON.stringify(c.reason_refs)!==JSON.stringify(restored[i].reason_refs)||c.caution_ref!==restored[i].caution_ref||c.criteria_spans!.some((s,j)=>s.key!==restored[i].criteria_spans![j].key||s.start!==restored[i].criteria_spans![j].start||s.end!==restored[i].criteria_spans![j].end)))throw Error('CACHE_INCOMPATIBLE');
 return restored;
}
export function renderCoveredChoices(choices:Choice[],p:Prepared,render:(id:string,ref:string)=>AiExplanation):AiSelection[]{
 function coverage(id:string,criteria:CoverageData['criteria_spans'],evidence:Evidence[]):CriterionCoverage[]{
  return evidence.map(e=>{const span=criteria[e.criterion],hint=p.criteriaHints.find(h=>h.key===span.key),vi=p.proposals[0]?.report.language==='vi',label=hint?(hint.expected?hint.label:(vi?'Tránh: ':'Éviter : ')+hint.label):(vi?'Tiêu chí từ nội dung tự do':'Critère du texte libre');
   return {criterion:label,label,request_span:{start:span.start,end:span.end},key:span.key,requirement:hint?.origin==='mandatory_filter'?'mandatory_filter':'preference',state:e.state,evidence:e.refs.map(ref=>render(id,ref))};});
 }
 return choices.map(c=>{
  const proposal=p.proposals.find(x=>x.establishment_id===c.id)!,data=c as Choice&CoverageData,cov=coverage(c.id,data.criteria_spans,data.criterion_evidence);
  const criteria=data.criteria_spans.map(s=>({key:s.key,quote:p.naturalLanguageRequest.slice(s.start,s.end)}));
  const cautions=data.caution_refs.map(ref=>({...render(c.id,ref),caution_context:cautionContext(p.facts.get(c.id)!.find(f=>f.ref===ref)!,p,c.id,criteria,data.criterion_evidence)!}));
  const used=new Set([...c.reason_refs,...data.criterion_evidence.flatMap(e=>e.refs),...data.caution_refs]);
  const other=p.facts.get(c.id)!.filter(f=>!used.has(f.ref)&&(f.kind==='reservation'||f.kind==='feature'&&['denied','conflicted'].includes(point(f).status??'')));
  const alternatives=data.alternative_ids.map(id=>({proposal:p.proposals.find(x=>x.establishment_id===id)!,coverage:coverage(id,data.criteria_spans,data.criteria_spans.map((s,criterion)=>{
   const hint=p.criteriaHints.find(h=>h.key===s.key);return {criterion,...(hint?assessment(hint.key,p.proposals.find(x=>x.establishment_id===id)!,p.facts.get(id)!,hint):{state:'unknown' as const,refs:[]})};
  }))}));
  return {proposal,reasons:c.reason_refs.map(ref=>render(c.id,ref)),caution:cautions[0]??null,coverage:cov,cautions,other_limits:other.map(f=>render(c.id,f.ref)),alternatives,match:cov.every(x=>x.state==='documented')?'documented':'partial'};
 });
}

/** Conservative source observations for a general ranking, never a personalized choice. */
export function conservativeCoverage(p:Prepared,id:string,render:(ref:string)=>AiExplanation):CriterionCoverage[]{
 const proposal=p.proposals.find(x=>x.establishment_id===id)!;
 return p.criteriaHints.map(h=>{const a=assessment(h.key,proposal,p.facts.get(id)!,h);return {criterion:h.label,label:h.label,key:h.key,request_span:{start:0,end:0},requirement:h.origin==='mandatory_filter'?'mandatory_filter':'preference',state:a.state,evidence:a.refs.map(render)};});
}
