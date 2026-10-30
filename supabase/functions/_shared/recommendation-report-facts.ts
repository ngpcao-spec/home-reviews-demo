import type {Citation,Proposal,SheetRow} from './restaurant-recommendation-engine-v1.ts';

export const REPORT_FACTS_VERSION='recommendation-report-points-v1';
type Obj=Record<string,unknown>;
const obj=(x:unknown):Obj=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Obj:{};
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[];
export function savedReportPoints(p:Proposal,row?:SheetRow):Citation[]{
 if(!row)return [...p.reasons.flatMap(r=>r.citations??[]),...p.reservations];
 if(row.report_id!==p.report.id||row.publication?.report_id!==p.report.id)return [];
 return (['positive_aspects','reservations'] as const).flatMap(section=>arr(row.report_sections[section]).flatMap((v,index)=>{
  const point=obj(v),durable=obj(arr(obj(row.publication?.derived.report)[section==='reservations'?'negative_aspects':section])[index]);
  return typeof point.text==='string'&&['quality','service','ambiance','price'].includes(String(point.category))&&point.text===durable.text&&point.category===durable.category
   &&Array.isArray(point.evidence_ids)&&point.evidence_ids.length>0&&point.evidence_ids.every(id=>typeof id==='string'&&/^[a-f\d]{64}$/i.test(id))&&JSON.stringify(point.evidence_ids)===JSON.stringify(durable.evidence_ids)
   ?[{report_id:p.report.id,section,index,category:String(point.category),text:point.text,evidence_ids:point.evidence_ids as string[]}]:[];
 }));
}

/** Local privacy minimization on published summaries only, never raw reviews.
 * Redact contacts and explicitly named people, without summarizing, clipping or removing a negative clause.
 * This is not a universal multilingual name recognizer. Report publication already uses anonymous prose;
 * current saved payloads are checked privately before release. No source prose is logged/persisted here. */
export function privateReportText(text:string){
 let safe=text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu,'');
 const contact='[contact redacted]',person='[person redacted]';
 safe=safe.replace(/(?:https?:\/\/|www\.)[^\s<>]+|[^\s@]+@[^\s@]+\.[^\s@]+|(?<![\p{L}\d])@[^\s<>]+/giu,contact)
  .replace(/(?<!\d)\+?\d(?:[ \t().-]*\d){7,}(?!\d)/gu,contact);
 // Honorifics and personal-role introductions; keep all surrounding observations/qualifiers intact.
 safe=safe.replace(/((?:\b(?:Mr|Mrs|Ms|Dr|Mme|Mlle|M)\.?|\b(?:[Mm]onsieur|[Mm]adame|[Pp]erson|[Pp]ersonne|[Cc]lient|[Cc]ustomer|[Ww]aiter|[Ww]aitress|[Ss]erveur|[Ss]erveuse|[Mm]anager|[Ss]taff)|(?:[Nn]hân viên|[Cc]hị|[Cc]ô|[Ôô]ng|[Bb]à|[Aa]nh|[Bb]ạn))\s+)(\p{Lu}[\p{L}\p{M}'’-]+(?:\s+\p{Lu}[\p{L}\p{M}'’-]+){0,2})/gu,(_,role:string)=>role+person);
 return {text:safe,redacted:safe!==text};
}

export function reportPoint(p:Proposal,c:Citation,row?:SheetRow){
 const pub=row?.publication,known=pub&&c.report_id===p.report.id&&row?.report_id===p.report.id&&pub.report_id===p.report.id&&pub.source_run_id===row.source_run_id
  &&pub.organization_id===row.organization_id&&pub.establishment_id===p.establishment_id&&pub.language===p.report.language&&Number.isFinite(Date.parse(pub.generated_at))&&Date.parse(pub.generated_at)===Date.parse(p.report.generated_at)
  &&pub.scope.fingerprint===p.report.corpus.fingerprint&&row.corpus.fingerprint===p.report.corpus.fingerprint;
 const sources=new Set(known?arr(pub.source_bindings).flatMap(v=>{const id=obj(v).id;return typeof id==='string'&&id?[id]:[];}):[]);
 const bindings=known?arr(pub.evidence_bindings).map(obj):[];
 const support=new Set<string>();let complete=!!known&&c.evidence_ids.length>0;
 for(const id of c.evidence_ids){
  const matches=bindings.filter(b=>b.evidence_id===id);
  const valid=matches.filter(b=>b.category===c.category&&b.polarity===(c.section==='reservations'?'negative':'positive')&&typeof b.review_id==='string'&&sources.has(b.review_id));
  const distinct=new Set(valid.map(b=>b.review_id as string));
  if(!matches.length||valid.length!==matches.length||distinct.size!==1)complete=false;
  for(const review of distinct)support.add(review);
 }
 const count=complete?support.size:null;
 return {category:c.category,...privateReportText(c.text),source:{kind:'published_report',report_id:c.report_id,section:c.section,index:c.index},distinct_reviews:count,
  support_scope:count===null?'unknown':count===1?'one_documented_review':'multiple_documented_reviews',
  recurrence:'unknown',relevance:'not_verified'};
}
