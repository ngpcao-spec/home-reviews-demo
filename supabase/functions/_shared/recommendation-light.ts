import type {Proposal,SheetRow} from './restaurant-recommendation-engine-v1.ts';
import {privateReportText,reportPoint,savedReportPoints} from './recommendation-report-facts.ts';

export const LIGHT_SHEET_VERSION='recommendation-light-v1';
type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
const clean=(v:string)=>privateReportText(v).text.replace(/\s+/gu,' ').trim();
const canonical=(v:unknown):string=>JSON.stringify(v===undefined?null:Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):v!==null&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical((v as Obj)[k]))])):v);

export type LightPoint={refs:string[];category:string;text:string;reviews:number|null};
export type LightSheet={id:string;name:string;cuisines:string[];specialties:string[];usages:string[];
 scores:Record<'global'|'quality'|'service'|'ambiance',string>;
 google_price:{range:Proposal['budget']['establishment']['range'];level:number|null;unit:'per_person'|null};
 review_summary:LightPoint[];reservations:LightPoint[];
 google_features:Record<string,boolean|'conflicted'>;
 review_features:Record<string,{refs:string[];context?:unknown}>;
 report:{date:string;freshness:Proposal['report']['freshness']}};
export type LightSheetCacheEntry={organization_id:string;establishment_id:string;language:string;format_version:string;source_sha256:string;sheet:LightSheet};
export type LightSheetCachePort={load:(organization:string,language:string)=>Promise<LightSheetCacheEntry[]>;save:(entries:LightSheetCacheEntry[])=>Promise<void>};

/** Content identity, not a report-id-only or request-dependent cache. The bounded
 * server memo is disposable on cold start; rebuilding is deterministic and free.
 * No row, publication, historical receipt or authorization is ever written. */
const memo=new Map<string,{identity:string;sheet:LightSheet}>();
export function lightSheetIdentity(row:SheetRow,language:string){
 return canonical({format:LIGHT_SHEET_VERSION,language,row});
}
export function restaurantLightSheet(row:SheetRow,language:string,proposal:()=>Proposal):LightSheet{
 const slot=canonical([row.organization_id,row.establishment_id,language]),identity=lightSheetIdentity(row,language),cached=memo.get(slot);
 if(cached?.identity===identity)return structuredClone(cached.sheet);
 const p=proposal(),points=savedReportPoints(p,row),summary:LightPoint[]=[],reservations:LightPoint[]=[];
 const add=(target:LightPoint[],point:LightPoint)=>{
  if(!point.text)return;
  const existing=target.find(x=>x.category===point.category&&x.text===point.text);
  if(existing){existing.refs.push(...point.refs.filter(r=>!existing.refs.includes(r)));existing.reviews=null;}
  else target.push(point);
 };
 for(const c of points){const point=reportPoint(p,c,row);add(c.section==='reservations'?reservations:summary,
  {refs:[`${c.section==='reservations'?'reservation':'strength'}_${c.category}_${c.index}`],category:c.category,text:clean(point.text),reviews:point.distinct_reviews});}
 // The published positive/negative summaries are primary. Fill gaps from saved
 // report observations whose evidence is not represented there. Do not append
 // a second conclusion/category narrative repeating the same observations.
 const covered=new Set(points.flatMap(c=>c.evidence_ids)),report=obj(row.publication?.derived.report);
 for(const recommendation of arr(report.recommendations)){
  const rec=obj(recommendation);
  for(const observation of arr(rec.observations)){
   const o=obj(observation);
   if(typeof o.text==='string'&&typeof o.evidence_id==='string'&&!covered.has(o.evidence_id)){
    add(reservations,{refs:[],category:typeof rec.category==='string'?rec.category:'unknown',text:clean(o.text),reviews:null});covered.add(o.evidence_id);
   }
  }
 }
 // Category text is a conservative fallback for evidence not present in the
 // concise summaries or observations. Never clip a reservation to a token cap.
 for(const value of arr(report.categories)){
  const c=obj(value),ids=arr(c.evidence_ids).filter((x):x is string=>typeof x==='string');
  if(typeof c.text==='string'&&ids.some(id=>!covered.has(id))){
   add(summary,{refs:[],category:typeof c.category==='string'?c.category:'unknown',text:clean(c.text),reviews:null});ids.forEach(id=>covered.add(id));
  }
 }
 const google_features:LightSheet['google_features']={},review_features:LightSheet['review_features']={};
 for(const [id,f] of Object.entries(p.practical?.attributes.facts??{}))google_features[id]=f.value===null?'conflicted':f.value;
 for(const [id,f] of Object.entries(p.features))if(f.citations.length)review_features[id]={
  refs:[...new Set(f.citations.map(c=>`${c.section==='reservations'?'reservation':'strength'}_${c.category}_${c.index}`))],...(f.context?{context:f.context}:{})};
 const price=p.budget.establishment;
 const sheet:LightSheet={id:p.establishment_id,name:clean(p.name),cuisines:p.cuisines.values,specialties:p.specialties,usages:p.usages,
  scores:Object.fromEntries(['global','quality','service','ambiance'].map(k=>[k,p.scores[k as keyof typeof p.scores].value])) as LightSheet['scores'],
  google_price:{range:price.range,level:price.level,unit:price.unit},review_summary:summary,reservations,google_features,review_features,
  report:{date:p.report.generated_at,freshness:p.report.freshness}};
 memo.delete(slot);memo.set(slot,{identity,sheet});
 if(memo.size>64)memo.delete(memo.keys().next().value!);
 return structuredClone(sheet);
}

/** One shared legend replaces repeated source/technical metadata per fact. */
export const lightSheetLegend={
 scores:'Internal fixed scores /6; not Google ratings. Keys global, quality, service, ambiance. Exact decimal values.',
 google_price:'Saved indicative Google Maps range/currency and level; null means unknown. Unit per_person only when confirmed. Review price opinions never establish budget fit.',
 google_features:'Saved Google Maps declarations only: true, false or conflicted. Missing keys are UNKNOWN, never false. Optional refs: feature_<key>.',
 review_features:'Report-derived observations, not Google declarations. Read referenced summary/reservation text and any scope; not an unconditional facility guarantee.',
 review_summary:'Published review summaries and essential supplementary report observations; not independently verified. refs are optional saved server citations.',
 reservations:'All saved reservations retained with qualifications. reviews counts distinct saved reviews for the WHOLE point, never incidents or recurrence; null=unknown. Even one review does not prove absence elsewhere. Recurrence remains unknown unless explicitly attributed in text, never independently verified.',
 report:'Report date and source freshness; corpus_changed means reviews changed since report. Missing information stays unknown.',
};
