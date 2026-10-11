import {json,preflight} from './cors.ts'
import {buildEvidenceAudit,evidenceAuditHash,prepareEvidenceV2Packet,type EvidenceAudit} from './pilot-evidence-audit.ts'
import type {PilotJob} from './jev-pilot-types.ts'
import type {PilotSnapshot} from './jev-pilot-core.ts'
import type {EconomyCache} from './jev-economy-cache.ts'
import {EVIDENCE_VERSION} from './pilot-evidence-rules.ts'
export interface EvidenceRecord {id:string;result:EvidenceAudit;result_sha256:string;created_at:string;created_by:string}
export interface EvidenceRepository {language:'fr'|'vi';source:()=>Promise<{snapshot:PilotSnapshot;report:PilotJob}|null>;cache:()=>Promise<(EconomyCache&{theme_results?:unknown})[]>;read:(snapshot_id:string,report_id:string)=>Promise<EvidenceRecord|null>;save:(snapshot_id:string,report_id:string,audit:EvidenceAudit,sha:string)=>Promise<void>}
export interface EvidenceView {version:string;ready:boolean;record:EvidenceRecord|null;review_texts:{review_id:string;analysis_text:string;sha256:string}[];packet:Awaited<ReturnType<typeof prepareEvidenceV2Packet>>|null;new_paid_calls:0;can_generate_report:false;production_enabled:false}
export function evidenceHandler(repository:(request:Request)=>Promise<EvidenceRepository>){return async(request:Request)=>{const p=preflight(request);if(p)return p;try{if(!['GET','POST'].includes(request.method))return json({error:'METHOD_NOT_ALLOWED'},405);const repo=await repository(request),source=await repo.source();let body:null|{action:string}=null;if(request.method==='POST'){body=await request.json();if(body?.action!=='audit_free')return json({error:'EVIDENCE_PAID_ACTION_DISABLED'},405)}
 if(!source)return json({version:EVIDENCE_VERSION,ready:false,record:null,review_texts:[],packet:null,new_paid_calls:0,can_generate_report:false,production_enabled:false});
 if(body){const a=await buildEvidenceAudit(source.snapshot,source.report,await repo.cache());await repo.save(source.snapshot.id,source.report.id,a,await evidenceAuditHash(a))}
 const record=await repo.read(source.snapshot.id,source.report.id),packet=record?await prepareEvidenceV2Packet(source.snapshot,record.result,record.result_sha256,repo.language):null,ids=new Set(record?[...record.result.previous.map(p=>p.review_id),...record.result.selected.map(p=>p.review_id)]:[]),review_texts=source.snapshot.source.reviews.filter(r=>ids.has(r.id)&&r.analysis_text).map(r=>({review_id:r.id,analysis_text:r.analysis_text!,sha256:r.analysis_text_sha256!}));
 return json({version:EVIDENCE_VERSION,ready:true,record,review_texts,packet,new_paid_calls:0,can_generate_report:false,production_enabled:false} satisfies EvidenceView)
 }catch(e){const error=e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'EVIDENCE_REQUEST_FAILED';return json({error},error==='UNAUTHORIZED'?401:error==='FORBIDDEN'?403:409)}}}
