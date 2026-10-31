import type {Request as EngineRequest,Proposal} from './restaurant-recommendation-engine-v1.ts';
import {shortlistPreferences} from './shortlist-preferences.ts';
import {placeFeatureLabel} from './google-place-taxonomy.ts';
import type {Choice,Fact,Prepared} from './recommendation-ai.ts';
import type {AiExplanation,AiSelection,CriterionCoverage,CriterionState} from './recommendation-ai-contract.ts';

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
function relevantCaution(f:Fact,p:Prepared,criteria:Criterion[]){
 if(f.kind==='reservation')return true;
 if(f.kind==='freshness')return (f.value as {state:string}).state==='corpus_changed';
 if(f.kind==='recurrence')return point(f).status==='reported_repetition';
 return f.kind==='feature'&&['denied','conflicted'].includes(point(f).status??'')
  &&(point(f).status==='conflicted'||criteria.some(c=>c.key===f.ref)||p.criteriaHints.some(h=>h.key===f.ref));
}
/** No free explanation is accepted. Quotes must come verbatim from the request; only
 * their offsets are persisted. Source references cannot cross restaurant/corpus boundaries. */
export function validateCoveredDecision(raw:unknown,p:Prepared):Choice[]{
 if(!exact(raw,['criteria','choices']))throw Error('INVALID_SELECTION');
 const v=raw as {criteria:Criterion[];choices:{id:string;reason_refs:string[];criterion_evidence:Evidence[];caution_refs:string[];alternative_ids:string[]}[]};
 if(!Array.isArray(v.criteria)||v.criteria.length>8||!Array.isArray(v.choices)||v.choices.length>3||!v.choices.length&&p.candidates.length)throw Error('INVALID_SELECTION');
 const hintKeys=p.criteriaHints.map(h=>h.key),keys:string[]=[],spans:CoverageData['criteria_spans']=[];
 for(const c of v.criteria){
  if(!exact(c,['key','quote'])||typeof c.quote!=='string'||c.quote.length>500||c.key!==null&&!hintKeys.includes(c.key)||!c.quote&&c.key===null)throw Error('INVALID_CRITERION');
  const start=c.quote?p.naturalLanguageRequest.indexOf(c.quote):0;
  if(start<0||!c.quote&&p.criteriaHints.find(h=>h.key===c.key)?.origin==='optional_text_hint')throw Error('INVALID_CRITERION');
  const hint=p.criteriaHints.find(h=>h.key===c.key);
  if(hint?.origin==='optional_text_hint'&&!criterionHints({geography:'not_requested'},c.quote,p.proposals[0]?.report.language==='vi'?'vi':'fr').some(h=>h.key===hint.key&&h.expected===hint.expected))throw Error('INVALID_CRITERION');
  if(c.key!==null){if(keys.includes(c.key))throw Error('INVALID_CRITERION');keys.push(c.key);}
  if(spans.some(s=>(s.key===c.key||s.key===null||c.key===null)&&s.start===start&&s.end===start+c.quote.length))throw Error('INVALID_CRITERION');
  spans.push({key:c.key,start,end:start+c.quote.length});
 }
 if(hintKeys.some(k=>!keys.includes(k))||p.naturalLanguageRequest&&!v.criteria.length)throw Error('MISSING_CRITERION');
 const seen=new Set<string>();
 for(const c of v.choices){
  if(!exact(c,['id','reason_refs','criterion_evidence','caution_refs','alternative_ids'])||typeof c.id!=='string'||seen.has(c.id)||!p.facts.has(c.id))throw Error('INVALID_SELECTION');
  seen.add(c.id);const facts=p.facts.get(c.id)!,proposal=p.proposals.find(x=>x.establishment_id===c.id)!;
  if(!unique(c.reason_refs)||!c.reason_refs.length||c.reason_refs.length>6||c.reason_refs.some(r=>!facts.some(f=>f.ref===r&&(['score','cuisine','price','strength'].includes(f.kind)||f.kind==='feature'&&['reported','denied'].includes(point(f).status??'')))))throw Error('INVALID_REFERENCE');
  if(!Array.isArray(c.criterion_evidence)||c.criterion_evidence.length!==v.criteria.length||!unique(c.caution_refs)||c.caution_refs.length>4||!unique(c.alternative_ids)||c.alternative_ids.length>2)throw Error('MISSING_CRITERION');
  for(const [i,e]of c.criterion_evidence.entries()){
   if(!exact(e,['criterion','state','refs'])||e.criterion!==i||!states.includes(e.state)||!unique(e.refs)||e.refs.length>2)throw Error('INVALID_CRITERION_EVIDENCE');
   const key=v.criteria[i].key,selected=e.refs.map(r=>facts.find(f=>f.ref===r));
   if(selected.some(f=>!f||!permittedForCriterion(f,key)))throw Error('INVALID_REFERENCE');
   if(key!==null){
    const expected=assessment(key,proposal,facts,p.criteriaHints.find(h=>h.key===key)!);
    if(e.state!==expected.state)throw Error('INVALID_CRITERION_EVIDENCE');
    if(key.startsWith('category_')){
     const positive=selected.some(f=>f?.kind==='strength'),negative=selected.some(f=>f?.kind==='reservation');
     if(e.state==='documented'&&!positive||e.state==='contradicted'&&!negative||e.state==='partial'&&(!positive||!negative)||e.state==='unknown'&&e.refs.length)throw Error('INVALID_CRITERION_EVIDENCE');
    }else if(expected.refs.some(r=>!e.refs.includes(r)))throw Error('INVALID_CRITERION_EVIDENCE');
   }else{
    // For open-ended needs, validate provenance/polarity rather than pretending a lexical
    // classifier can prove semantic relevance. Display remains an attributed source, not free prose.
    const positive=selected.some(f=>f&&['strength','cuisine','price','freshness'].includes(f.kind)||f?.kind==='feature'&&['reported','denied'].includes(point(f).status??''));
    const negative=selected.some(f=>f?.kind==='reservation'||f?.kind==='feature'&&['denied','reported'].includes(point(f).status??''));
    if(e.state==='documented'&&!positive||e.state==='contradicted'&&!negative||e.state==='partial'&&!selected.length||e.state==='conflicted'&&!selected.some(f=>f?.kind==='feature'&&point(f).status==='conflicted'))throw Error('INVALID_CRITERION_EVIDENCE');
   }
  }
  if(c.caution_refs.some(r=>!facts.some(f=>f.ref===r&&relevantCaution(f,p,v.criteria))))throw Error('IRRELEVANT_CAUTION');
 }
 const alternatives=[...new Set(v.choices.flatMap(c=>c.alternative_ids))];
 if(alternatives.length>2||alternatives.some(id=>seen.has(id)||!p.facts.has(id)))throw Error('INVALID_ALTERNATIVE');
 let comparisonNeeded=false,comparisonProvided=false;
 for(const h of p.criteriaHints){
  const selectedMatches=v.choices.some(c=>assessment(h.key,p.proposals.find(x=>x.establishment_id===c.id)!,p.facts.get(c.id)!,h).state==='documented');
  const better=p.proposals.filter(x=>!seen.has(x.establishment_id)&&assessment(h.key,x,p.facts.get(x.establishment_id)!,h).state==='documented');
  if(!selectedMatches&&better.length){comparisonNeeded=true;if(alternatives.some(id=>better.some(x=>x.establishment_id===id)))comparisonProvided=true;}
 }
 if(comparisonNeeded&&!comparisonProvided)throw Error('MISSING_TRADEOFF');
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
  const cautions=data.caution_refs.map(ref=>render(c.id,ref));
  const used=new Set([...c.reason_refs,...data.criterion_evidence.flatMap(e=>e.refs),...data.caution_refs]);
  const other=p.facts.get(c.id)!.filter(f=>!used.has(f.ref)&&(f.kind==='reservation'||f.kind==='feature'&&['denied','conflicted'].includes(point(f).status??'')));
  const alternatives=data.alternative_ids.map(id=>({proposal:p.proposals.find(x=>x.establishment_id===id)!,coverage:coverage(id,data.criteria_spans,data.criteria_spans.map((s,criterion)=>{
   const hint=p.criteriaHints.find(h=>h.key===s.key);return {criterion,...(hint?assessment(hint.key,p.proposals.find(x=>x.establishment_id===id)!,p.facts.get(id)!,hint):{state:'unknown' as const,refs:[]})};
  }))}));
  return {proposal,reasons:c.reason_refs.map(ref=>render(c.id,ref)),caution:cautions[0]??null,coverage:cov,cautions,other_limits:other.map(f=>render(c.id,f.ref)),alternatives,match:cov.every(x=>x.state==='documented')?'documented':'partial'};
 });
}
