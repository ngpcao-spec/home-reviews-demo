import type {Citation,Proposal} from './restaurant-recommendation-engine-v1.ts';
import type {AiExplanation,ExplanationSource} from './recommendation-ai-contract.ts';

type Obj=Record<string,unknown>;
const obj=(x:unknown):Obj=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Obj:{};
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[];
function googleLink(p:Proposal):string|null{
 const identity=p.practical?.identity;if(!identity?.google_maps_url)return null;
 try{const u=new URL(identity.google_maps_url),cid=u.searchParams.get('cid'),place=u.searchParams.get('query_place_id');
  return u.protocol==='https:'&&['www.google.com','maps.google.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port&&/^\/maps(?:\/|$)/.test(u.pathname)
   &&(cid!==null||place!==null)&&(cid===null||cid===identity.cid)&&(place===null||place===identity.place_id)?u.href:null;
 }catch{return null;}
}
function boundCitations(p:Proposal,bindings:unknown,available:Citation[]):Citation[]{
 return arr(bindings).flatMap(binding=>{
  const b=obj(binding),c=available.find(c=>c.report_id===p.report.id&&b.report_id===c.report_id&&b.section===c.section&&b.index===c.index
   &&JSON.stringify(b.evidence_ids)===JSON.stringify(c.evidence_ids));return c?[c]:[];
 }).filter((c,i,all)=>all.findIndex(x=>x.section===c.section&&x.index===c.index)===i);
}
const reportSources=(p:Proposal,citations:Citation[]):ExplanationSource[]=>citations.map(c=>({kind:'report',...c,generated_at:p.report.generated_at}));

/** Presentation only, after selection/reference validation. Never used to build the model request or rank candidates.
 * The model selected a reference, not the prose rendered here. All prose is copied from its bound saved source. */
export function explainSavedReference(p:Proposal,ref:string,label:string,source:unknown,language:'fr'|'vi'):AiExplanation{
 const base={ref,text:label,source},vi=language==='vi';
 if(ref.startsWith('strength_')||ref.startsWith('reservation_')){
  const reservation=ref.startsWith('reservation_'),category=ref.slice(reservation?12:9);
  const available=reservation?p.reservations:p.reasons.flatMap(r=>r.citations??[]);
  const citations=boundCitations(p,source,available).filter(c=>c.category===category&&c.section===(reservation?'reservations':'positive_aspects'));
  return citations.length?{...base,text:citations[0].text,display_kind:'report_extract',sources:reportSources(p,citations),notes:reservation?['recurrence_requires_source_check']:[]}
   :{...base,display_kind:'source_unavailable',sources:[],notes:['source_unavailable']};
 }
 if(ref.startsWith('feature_')){
  const name=ref.slice(8),feature=p.features[name],bindings=obj(source);
  const google=p.practical?.attributes.facts[name];
  const sources:ExplanationSource[]=[];
  const boundGoogle=obj(bindings.google);
  if(feature?.google&&google&&boundGoogle.source===p.practical?.attributes.source&&boundGoogle.observed_at===p.practical?.attributes.observed_at){
   for(const evidence of google.evidence)for(const field of evidence.source_fields)sources.push({kind:'google_maps',observed_at:p.practical?.attributes.observed_at??null,field,label:evidence.label,value:evidence.value,url:googleLink(p)});
  }
  const citations=boundCitations(p,bindings.report,feature?.citations??[]);sources.push(...reportSources(p,citations));
  if(sources.some(s=>s.kind==='google_maps')){
   const description=feature.status==='reported'?(vi?'Google Maps ghi nhận là có':'Google Maps indique oui'):feature.status==='denied'?(vi?'Google Maps ghi nhận là không':'Google Maps indique non'):(vi?'thông tin trái chiều':'informations contradictoires');
   return {...base,text:`${feature.label??name} : ${description}.`,display_kind:'google_declaration',sources,notes:name==='quiet'?['google_not_noise_measurement']:[]};
  }
  if(citations.length)return {...base,text:citations[0].text,display_kind:'report_extract',sources,notes:[]};
  return {...base,display_kind:'source_unavailable',sources:[],notes:['source_unavailable']};
 }
 if(ref.startsWith('score_')){
  const category=ref.slice(6),score=p.scores[category as keyof typeof p.scores];
  if(score&&obj(source).report_id===p.report.id&&obj(source).date===p.report.generated_at)return {...base,display_kind:'internal_score',sources:[{kind:'internal_score',report_id:p.report.id,generated_at:p.report.generated_at,category,score:score.value}],notes:[]};
  return {...base,display_kind:'source_unavailable',sources:[],notes:['source_unavailable']};
 }
 return {...base,display_kind:'saved_metadata',sources:[],notes:[]};
}
