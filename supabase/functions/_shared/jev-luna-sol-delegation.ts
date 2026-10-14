import { hybridHash } from "./jev-hybrid-evidence.ts";
import { type JlsPlan, type JlsDecision, acceptedSolDossier } from "./jev-luna-sol.ts";
export const JLS_PILOT_PLAN = "5295245f-b2c1-4f5d-80ad-ca9f821ae3da";
export const JLS_PILOT_SHA = "c096931805dbc7d4e655df7d1aaddd6bc92e96a6de784835e07c0220673b485a";
export const JLS_DELEGATION_VERSION = "jls-codex-delegated-pilot-v1";
export const JLS_SUFFICIENCY = Object.freeze({ version: "jls-evidence-sufficiency-v1", accepted: 12,
  axes: { quality: 2, service: 2, price: 2, atmosphere: 1 }, negative: 6, low_star: 4,
  complete_calls: 24, complete_questions: 25, confidence_min: .60 });
export function evidenceSufficiency(p: JlsPlan, acceptedIds: string[], complete: boolean) {
  const rows = p.selected.filter(e => acceptedIds.includes(e.evidence_id)),
    axes = Object.fromEntries(Object.keys(JLS_SUFFICIENCY.axes).map(a => [a, rows.filter(e=>e.axis===a).length])),
    negative = rows.filter(e=>e.polarity==="negative").length,
    low_star = rows.filter(e=>e.rating>=1&&e.rating<=3).length;
  const reasons = [];
  if (!complete) reasons.push("LUNA_INCOMPLETE_OR_FAILED");
  if (rows.length<JLS_SUFFICIENCY.accepted) reasons.push("ACCEPTED_BELOW_MINIMUM");
  for (const [a,n] of Object.entries(JLS_SUFFICIENCY.axes)) if (axes[a]<n) reasons.push("AXIS_BELOW_MINIMUM_"+a.toUpperCase());
  if(negative<JLS_SUFFICIENCY.negative)reasons.push("NEGATIVE_BELOW_MINIMUM");
  if(low_star<JLS_SUFFICIENCY.low_star)reasons.push("LOW_STAR_BELOW_MINIMUM");
  return { passed:reasons.length===0, accepted:rows.length, axes, negative, low_star, reasons,
    policy:JLS_SUFFICIENCY, human_validated:false };
}
export async function delegatedProtocol(id: string, p: JlsPlan, sha: string) {
  if(id!==JLS_PILOT_PLAN||sha!==JLS_PILOT_SHA||await hybridHash(p)!==sha||p.language!=="vi"||
    p.max_luna_calls!==24||p.question_count!==25||p.statistics.coverage.analysed_reviews!==422||
    p.config.confidence_min!==.6||p.config.luna_model!=="gpt-6-luna"||p.config.sol_model!=="gpt-6.1-sol")throw new Error("JLS_DELEGATION_SCOPE_CHANGED");
  return { version:JLS_DELEGATION_VERSION, plan_id:id, plan_sha256:sha, config_sha256:p.config_sha256,
    dossier_sha256:p.dossier_sha256, organization_id:p.organization_id, source_snapshot_id:p.source_snapshot_id,
    source_sha256:p.source_sha256, luna_manifest_sha256:p.luna_manifest_sha256,
    max_luna_calls:24,max_sol_calls:1,question_count:25,jev_new_calls:0,
    luna_model:"gpt-6-luna",luna_endpoint:"/v1/decisions",sol_model:"gpt-6.1-sol",sol_endpoint:"/v1/responses",
    language:"vi",automatic_retry:false,production_enabled:false,
    sufficiency:JLS_SUFFICIENCY, feasibility:evidenceSufficiency(p,p.selected.map(e=>e.evidence_id),true),
    estimates:p.estimates, future_explicit_execution_consent_required:true,
    consent_source:"user_directive_codex_delegation",operator_identity:{kind:"codex_admin",channel:"supabase_mcp"},
    attestation:"authenticated_service_role_record_with_directive_and_canonical_sha256_not_a_human_session",
    preparation_is_not_spending_authorization:true };
}
export interface JlsExecutionTask {
  id:string;run_id:string;organization_id:string;phase:"luna"|"sol";review_id:string|null;
  request:unknown;request_sha256:string;status:string;request_count:number;lease_owner:string|null;
  parsed: {decisions:JlsDecision[]}|null;input_tokens:number|null;output_tokens:number|null;cost_usd:number|null;
  duration_ms:number|null;served_model:string|null;error_code:string|null;
}
export async function prepareAcceptedSol(p:JlsPlan,tasks:JlsExecutionTask[]) {
  const luna=tasks.filter(t=>t.phase==="luna"), complete=luna.length===24&&luna.every(t=>t.status==="completed"&&t.request_count===1&&t.parsed);
  const ds=luna.flatMap(t=>t.parsed?.decisions??[]), accepted=ds.filter(d=>d.status==="ACCEPTED").map(d=>d.evidence_id);
  const gate=evidenceSufficiency(p,accepted,complete&&ds.length===25&&new Set(ds.map(d=>d.evidence_id)).size===25);
  if(!gate.passed)return {gate,dossier:null,decisions:ds};
  return {gate,dossier:await acceptedSolDossier(p,ds),decisions:ds};
}
export function executionCosts(tasks:JlsExecutionTask[]) {
  const phase=(s:string)=>{const sent=tasks.filter(t=>t.phase===s&&t.request_count===1),unknown=sent.filter(t=>t.input_tokens===null||t.cost_usd===null).length;
    const known=sent.reduce((n,t)=>n+(t.cost_usd??0),0);
    return {attempts:sent.length,known_cost_usd:known,cost_usd:unknown?null:known,unknown_usage_calls:unknown,
      input_tokens:sent.reduce((n,t)=>n+(t.input_tokens??0),0),output_tokens:sent.reduce((n,t)=>n+(t.output_tokens??0),0),
      duration_ms:sent.reduce((n,t)=>n+(t.duration_ms??0),0),served_models:[...new Set(sent.flatMap(t=>t.served_model?[t.served_model]:[]))]};};
  const luna=phase("luna"),sol=phase("sol");return {luna,sol,total_cost_usd:luna.cost_usd===null||sol.cost_usd===null?null:luna.cost_usd+sol.cost_usd,
    calculated_not_verified_invoice:true,jev_new_calls:0};
}
