// One new wait_time question; every reused decision keeps its original identity.
// This compiler has no provider capability and creates no spending authority.
import {CONTRACT_V2_POLICY,compileContractPreparation,verifyContractBindings,contractBranch,type ContractSource,type ContractCandidate,type ContractV2Row,type ContractBranch} from "./jls-contract-v2-preparation.ts";
import {verifySnapshotReady,CHILL} from "./jls-snapshot-v2.ts";
import {CONFIG_V21,CONTRACT_V21,recommendationFromV2DraftV21,recommendationPromptV21} from "./jls-recommendation-contract-v21.ts";
import {recommendationInstructionsV2,recommendationSchemaV2} from "./jls-recommendation-contract-v2.ts";
import {SERVICE_CLASSIFICATION_INSTRUCTIONS,beverageDelaySpan} from "./jls-service-boundaries-v21.ts";
import {acceptedJlsEvidence,type JlsDecision} from "./jev-luna-sol.ts";
import {hybridHash} from "./jev-hybrid-evidence.ts";
import {negativeHash} from "./negative-validation-core.ts";
import {canonicalJson} from "./jev-exploratory-core.ts";
import {SOL_SIZE_POLICY} from "./jls-sol-size.ts";
export const CHILL_V21="jls-chill-targeted-v2.1-delegated-vi-v1";
export const CHILL_V21_ARCHIVE="ff28e270-f330-453c-85ea-a1860425bbe5";
export const CHILL_WAIT="ea98b7c1ce48de265026fb9d94ab82e8aff3653f32b2dc3478f7e4687a0ff97e";
export const CHILL_OLD_DRINK="7f9809ab307f386b177babd74a39a547dbaf1fecc46354808da6a36755d811e8";
export const CHILL_V21_POLICY=Object.freeze({...CONTRACT_V2_POLICY,version:CHILL_V21});
type Archive={id:string;sha256:string;body:{version:string;source_run_id:string;source_protocol_id:string;source_protocol_sha256:string;
 source_artifact_sha256:string;source_result_sha256:string;source_decisions_sha256:string;
 candidates:ContractCandidate[];future_preparation:{prompt_sha256:string;schema_sha256:string;configuration_sha256:string}}};
export async function chillV21Expected(){return {version:CONTRACT_V21,prompt_sha256:await negativeHash(recommendationPromptV21(recommendationInstructionsV2("vi"))),
 schema_sha256:await hybridHash(recommendationSchemaV2()),config_sha256:await hybridHash({...CONFIG_V21,sol_size_policy:SOL_SIZE_POLICY})};}
export async function prepareChillV21(source:ContractSource,archive:Archive,code:string){
 const p=source.protocol.body,a=source.artifact.body,r=archive.body,expected=await chillV21Expected();
 await verifySnapshotReady(p,source.protocol.sha256,source.artifact);
 if(archive.id!==CHILL_V21_ARCHIVE||!source.artifact.id||await hybridHash(r)!==archive.sha256||r.version!=="jls-reservation-beverage-review-v2.1"||
  p.establishment_id!==CHILL||p.snapshot.source.reviews.length!==100||p.english_review_ids.length!==80||a.plan.cache_fingerprints.length!==80||
  r.source_protocol_id!==source.protocol.id||r.source_protocol_sha256!==source.protocol.sha256||r.source_artifact_sha256!==source.artifact.sha256||
  r.source_decisions_sha256!==a.decisions_sha256||r.source_run_id!==a.source_run_id||r.candidates.length!==1||
  r.future_preparation.prompt_sha256!==expected.prompt_sha256||r.future_preparation.schema_sha256!==expected.schema_sha256||
  r.future_preparation.configuration_sha256!==expected.config_sha256||!/^[a-f0-9]{40}$/.test(code))throw Error("JLS_CHILL_V21_SOURCE_CHANGED");
 const candidate=r.candidates[0],old=a.plan.selected.find(e=>e.evidence_id===CHILL_OLD_DRINK);
 if(candidate.evidence_id!==CHILL_WAIT||candidate.theme_key!=="wait_time"||candidate.polarity!=="negative"||candidate.axis!=="service"||
  candidate.luna_verdict!==null||!beverageDelaySpan(candidate.quote)||!old||old.review_id!==candidate.review_id||old.theme_key!=="drinks")throw Error("JLS_CHILL_WAIT_VERIFICATION_REQUIRED");
 acceptedJlsEvidence(a.plan,a.decisions);
 const prepared=await compileContractPreparation(source,{id:archive.id,sha256:archive.sha256,run_id:r.source_run_id,result_sha256:r.source_result_sha256},candidate,old,code,
  {version:CHILL_V21,configuration:CHILL_V21_POLICY,question_instructions:" "+SERVICE_CLASSIFICATION_INSTRUCTIONS,
   // Same V2 response shape, independently versioned prompt/config/validator.
   transformDraft:async(plan,draft)=>await recommendationFromV2DraftV21(plan,draft) as unknown as ContractBranch["draft"]});
 await verifyChillV21(prepared,source);return prepared;
}
export async function verifyChillV21(row:Pick<ContractV2Row,"body"|"sha256">,source:ContractSource){
 await verifyContractBindings(row,source,CHILL_V21,CHILL_V21_POLICY);
 const p=row.body,a=source.artifact.body,s=source.protocol.body;
 if(p.source_archive_id!==CHILL_V21_ARCHIVE||p.establishment_id!==CHILL||p.candidate_evidence_id!==CHILL_WAIT||p.removed_evidence_id!==CHILL_OLD_DRINK||
  s.snapshot.source.reviews.length!==100||s.english_review_ids.length!==80||a.plan.cache_fingerprints.length!==80||
  await hybridHash(s)!==source.protocol.sha256||p.source_run_id!==a.source_run_id||p.source_decisions_sha256!==a.decisions_sha256||
  canonicalJson(p.plan.config)!==canonicalJson(a.plan.config)||p.plan.config_sha256!==a.plan.config_sha256||
  canonicalJson(p.plan.cache_fingerprints)!==canonicalJson(a.plan.cache_fingerprints)||
  canonicalJson(p.plan.luna_groups.slice(0,-1))!==canonicalJson(a.plan.luna_groups)||canonicalJson(p.plan.luna_groups.at(-1))!==canonicalJson(p.luna_group)||
  p.plan.luna_manifest_sha256!==await hybridHash(p.plan.luna_groups)||p.plan.dossier_sha256!==await hybridHash(p.plan.selected)||p.plan.max_luna_calls!==1||
  p.reused_decisions.length!==a.decisions.filter(d=>d.evidence_id!==CHILL_OLD_DRINK).length||
  p.plan.selected.filter(e=>e.evidence_id!==CHILL_WAIT).some(e=>!a.plan.selected.some(old=>canonicalJson(old)===canonicalJson(e))))throw Error("JLS_CHILL_V21_REUSE_CHANGED");
 const e=p.plan.selected.find(e=>e.evidence_id===CHILL_WAIT)!,input=JSON.parse(p.luna_group.payload.input),q=p.luna_group.payload.questions[0];
 const text=s.snapshot.source.reviews.find(r=>r.id===e.review_id)!.analysis_text!;
 if(e.theme_key!=="wait_time"||e.polarity!=="negative"||e.axis!=="service"||!beverageDelaySpan(e.quote)||
  Object.keys(input).sort().join(",")!=="analysis_text,review_alias"||input.analysis_text!==text||q.name!==CHILL_WAIT||
  !q.instructions.includes(SERVICE_CLASSIFICATION_INSTRUCTIONS)||!q.instructions.includes(JSON.stringify(e.quote))||
  await negativeHash(text)!==e.analysis_text_sha256||await hybridHash(p.luna_group.payload.questions)!==p.luna_group.questions_sha256)throw Error("JLS_CHILL_V21_QUESTION_CHANGED");
}
export async function chillV21Branch(row:ContractV2Row,source:ContractSource,decision:JlsDecision){
 return contractBranch(row,source,decision,await chillV21Expected());
}
