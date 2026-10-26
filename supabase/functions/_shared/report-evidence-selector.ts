// Request-scoped dispatch only. Never consult global settings while selecting.
import {DIRECT_COVERAGE_VERSION,DIRECT_COVERAGE_POLICY,directCoverageSelectorHash,selectDirectCoverage} from './jev-direct-evidence-selection.ts';
import {SOURCE_COMPLETION_POLICY,selectSourceCompletePriorityEvidence} from './jev-priority-evidence-selection.ts';
import {MIXED_SOURCE_COMPLETION_POLICY,selectMixedSourceCompletePriorityEvidence} from './jev-mixed-priority-evidence-selection.ts';
import {directHash} from './jev-direct-categories.ts';
import type {DirectReportEvidence} from './jev-direct-report-preparation.ts';

export const PRIORITY_SELECTOR_VERSION=SOURCE_COMPLETION_POLICY.version;
export const TESTED_SELECTOR_COMMIT='a9ed8d56f4f29ba33956fbf72a756c2e6ff20d7d';
export const TESTED_SELECTOR_SOURCE_SHA256='6dbe06273fd3c04e783032340f0468e40493e78b672f13d797b94670845e0b97';
export const MIXED_SELECTOR_VERSION=MIXED_SOURCE_COMPLETION_POLICY.version;
export const MIXED_TESTED_SELECTOR_COMMIT='f1627c4e7e86314e61af9e103a52016cca8dfc5d';
export const MIXED_TESTED_SELECTOR_SOURCE_SHA256='95e7b9ff4ca650a254303154db51961679fb670aab76a741dd0608d807bbda2c';
export const SUPPORTED_EVIDENCE_SELECTORS=[DIRECT_COVERAGE_VERSION,PRIORITY_SELECTOR_VERSION,MIXED_SELECTOR_VERSION] as const;
export type EvidenceSelectorVersion=typeof SUPPORTED_EVIDENCE_SELECTORS[number];
export interface EvidenceSelectorBinding {version:EvidenceSelectorVersion;sha256:string}
export function evidenceSelectorVersion(value:unknown):EvidenceSelectorVersion {
 if(value===DIRECT_COVERAGE_VERSION||value===PRIORITY_SELECTOR_VERSION||value===MIXED_SELECTOR_VERSION)return value;
 throw Error('REPORT_EVIDENCE_SELECTOR_VERSION_INVALID');
}
export async function evidenceSelectorBinding(value:unknown=DIRECT_COVERAGE_VERSION):Promise<EvidenceSelectorBinding>{
 const version=evidenceSelectorVersion(value);
 if(version===DIRECT_COVERAGE_VERSION)return {version,sha256:await directCoverageSelectorHash()};
 return {version,sha256:await directHash({
  policy:version===MIXED_SELECTOR_VERSION?MIXED_SOURCE_COMPLETION_POLICY:SOURCE_COMPLETION_POLICY,base_selector_sha256:await directCoverageSelectorHash(),
  tested_commit:version===MIXED_SELECTOR_VERSION?MIXED_TESTED_SELECTOR_COMMIT:TESTED_SELECTOR_COMMIT,
  tested_source_sha256:version===MIXED_SELECTOR_VERSION?MIXED_TESTED_SELECTOR_SOURCE_SHA256:TESTED_SELECTOR_SOURCE_SHA256})};
}
export async function verifyEvidenceSelector(binding:EvidenceSelectorBinding){
 const expected=await evidenceSelectorBinding(binding?.version);
 if(!binding||Object.keys(binding).sort().join(',')!=='sha256,version'||binding.sha256!==expected.sha256)throw Error('REPORT_EVIDENCE_SELECTOR_CHANGED');
 return expected;
}
// Older requests may arrive from pre-hash workers. Never infer a missing hash
// for the newly introduced version; its creation-time binding is mandatory.
export async function requestEvidenceSelector(version:unknown,sha256:unknown){
 const v=evidenceSelectorVersion(version??DIRECT_COVERAGE_VERSION);
 if(sha256===undefined||sha256===null){
  if(v===MIXED_SELECTOR_VERSION)throw Error('REPORT_EVIDENCE_SELECTOR_CHANGED');
  return await evidenceSelectorBinding(v);
 }
 return await verifyEvidenceSelector({version:v,sha256} as EvidenceSelectorBinding);
}
export function evidenceSelectorPolicy(version:EvidenceSelectorVersion){
 evidenceSelectorVersion(version);
 return version===DIRECT_COVERAGE_VERSION?DIRECT_COVERAGE_POLICY:version===MIXED_SELECTOR_VERSION?MIXED_SOURCE_COMPLETION_POLICY:SOURCE_COMPLETION_POLICY;
}
export function selectReportEvidence(candidates:DirectReportEvidence[],version:EvidenceSelectorVersion,max=32){
 evidenceSelectorVersion(version);
 return version===DIRECT_COVERAGE_VERSION?selectDirectCoverage(candidates,max):version===MIXED_SELECTOR_VERSION?selectMixedSourceCompletePriorityEvidence(candidates,max):selectSourceCompletePriorityEvidence(candidates,max);
}
