// Request-scoped dispatch only. Never consult global settings while selecting.
import {DIRECT_COVERAGE_VERSION,DIRECT_COVERAGE_POLICY,directCoverageSelectorHash,selectDirectCoverage} from './jev-direct-evidence-selection.ts';
import {SOURCE_COMPLETION_POLICY,selectSourceCompletePriorityEvidence} from './jev-priority-evidence-selection.ts';
import {directHash} from './jev-direct-categories.ts';
import type {DirectReportEvidence} from './jev-direct-report-preparation.ts';

export const PRIORITY_SELECTOR_VERSION=SOURCE_COMPLETION_POLICY.version;
export const TESTED_SELECTOR_COMMIT='a9ed8d56f4f29ba33956fbf72a756c2e6ff20d7d';
export const TESTED_SELECTOR_SOURCE_SHA256='6dbe06273fd3c04e783032340f0468e40493e78b672f13d797b94670845e0b97';
export type EvidenceSelectorVersion=typeof DIRECT_COVERAGE_VERSION|typeof PRIORITY_SELECTOR_VERSION;
export interface EvidenceSelectorBinding {version:EvidenceSelectorVersion;sha256:string}
export function evidenceSelectorVersion(value:unknown):EvidenceSelectorVersion {
 if(value===DIRECT_COVERAGE_VERSION||value===PRIORITY_SELECTOR_VERSION)return value;
 throw Error('REPORT_EVIDENCE_SELECTOR_VERSION_INVALID');
}
export async function evidenceSelectorBinding(value:unknown=DIRECT_COVERAGE_VERSION):Promise<EvidenceSelectorBinding>{
 const version=evidenceSelectorVersion(value);
 return {version,sha256:version===DIRECT_COVERAGE_VERSION?await directCoverageSelectorHash():await directHash({
  policy:SOURCE_COMPLETION_POLICY,base_selector_sha256:await directCoverageSelectorHash(),
  tested_commit:TESTED_SELECTOR_COMMIT,tested_source_sha256:TESTED_SELECTOR_SOURCE_SHA256})};
}
export async function verifyEvidenceSelector(binding:EvidenceSelectorBinding){
 const expected=await evidenceSelectorBinding(binding?.version);
 if(!binding||Object.keys(binding).sort().join(',')!=='sha256,version'||binding.sha256!==expected.sha256)throw Error('REPORT_EVIDENCE_SELECTOR_CHANGED');
 return expected;
}
export function evidenceSelectorPolicy(version:EvidenceSelectorVersion){
 evidenceSelectorVersion(version);
 return version===DIRECT_COVERAGE_VERSION?DIRECT_COVERAGE_POLICY:SOURCE_COMPLETION_POLICY;
}
export function selectReportEvidence(candidates:DirectReportEvidence[],version:EvidenceSelectorVersion,max=32){
 evidenceSelectorVersion(version);
 return version===DIRECT_COVERAGE_VERSION?selectDirectCoverage(candidates,max):selectSourceCompletePriorityEvidence(candidates,max);
}
