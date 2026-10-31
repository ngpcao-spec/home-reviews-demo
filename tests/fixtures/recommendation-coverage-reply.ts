import type {Prepared} from '../../supabase/functions/_shared/recommendation-ai';
/** Simulated provider reply for transport/UI tests only. This is not a model evaluation. */
export function coveredReply(p:Prepared,choices:{id:string;reason_refs:string[];caution_ref:string|null}[]){
 return coveredWireReply(JSON.parse(p.request.input),choices);
}
type Input={natural_language_request:string;criterion_hints:{key:string}[];candidates:{id:string;criterion_observations:{key:string;state:string;refs:string[]}[]}[]};
export function coveredWireReply(input:Input,choices:{id:string;reason_refs:string[];caution_ref:string|null}[]){
 const criteria=input.criterion_hints.length?input.criterion_hints.map(h=>({key:h.key,quote:input.natural_language_request})):input.natural_language_request?[{key:null,quote:input.natural_language_request}]:[];
 const ids=new Set(choices.map(c=>c.id));
 const alternatives=input.criterion_hints.flatMap(h=>choices.some(c=>input.candidates.find(x=>x.id===c.id)?.criterion_observations.find(x=>x.key===h.key)?.state==='documented')?[]:
  input.candidates.filter(c=>!ids.has(c.id)&&c.criterion_observations.find(x=>x.key===h.key)?.state==='documented').slice(0,1).map(c=>c.id));
 return {criteria,choices:choices.map((c,i)=>({id:c.id,reason_refs:c.reason_refs,criterion_evidence:criteria.map((cr,criterion)=>{
  const obs=input.candidates.find(x=>x.id===c.id)?.criterion_observations.find(x=>x.key===cr.key);
  return {criterion,state:obs?.state??'unknown',refs:obs?.refs??[]};
 }),caution_refs:c.caution_ref?[c.caution_ref]:[],alternative_ids:i===0?[...new Set(alternatives)].slice(0,2):[]}))};
}
