import { hybridHash } from "./jev-hybrid-evidence.ts";
import { negativeHash } from "./negative-validation-core.ts";
import { validatePrioritizedReport } from "./jev-luna-sol-prioritized-validation.ts";
import { JLS_DISCLOSURE_VALIDATOR, JLS_LEGACY_VALIDATOR } from "./jls-fee-disclosure.ts";
import type { JlsPlan, JlsDecision } from "./jev-luna-sol.ts";
import type { PilotSnapshot } from "./jev-pilot-core.ts";
import type { PrioritizedExecutionResult } from "./jls-prioritized-worker.ts";
export const JLS_PRI_REVALIDATION_VERSION = "jls-fee-disclosure-revalidation-v1";
export const JLS_PRI_REVALIDATION_ACTION = "prioritized_fee_disclosure_revalidated_v1";
type Original = { body: PrioritizedExecutionResult; sha256: string };
export function originalPrioritizedOutput(original: Original) {
  const messages = original.body.response?.output as { type: string; content?: { type: string; text: string }[] }[];
  const texts = messages?.filter(x => x.type === "message").flatMap(x => x.content ?? []).filter(x => x.type === "output_text");
  if (texts?.length !== 1) throw new Error("JLS_PRI_SOURCE_RESPONSE_INVALID");
  return JSON.parse(texts[0].text);
}
function reportContent(value: NonNullable<PrioritizedExecutionResult["validated_report"]>) {
  return { ...value, report: { ...value.report, recommendations: value.report.recommendations.map(x => {
    const { status: _s, visible: _v, reasons: _r, ...content } = x;
    return content;
  }) } };
}
export async function buildPrioritizedRevalidation(runId: string, original: Original, p: JlsPlan, snapshot: PilotSnapshot, decisions: JlsDecision[], provenance: { commit: string; files: Record<string,string> }) {
  const o = original.body;
  if (await hybridHash(o) !== original.sha256 || !o.response || await hybridHash(o.response) !== o.response_sha256 ||
    !o.raw_response_text || await negativeHash(o.raw_response_text) !== o.raw_response_sha256 || !o.validated_report ||
    o.served_model !== "gpt-6.1-sol" || !o.controls.json_valid || !o.controls.model_matches ||
    !/^[a-f0-9]{40}$/.test(provenance.commit) || Object.keys(provenance.files).length < 3 ||
    Object.values(provenance.files).some(x=>!/^[a-f0-9]{64}$/.test(x))) throw new Error("JLS_PRI_REVALIDATION_SOURCE_CHANGED");
  const raw = originalPrioritizedOutput(original);
  const legacy = await validatePrioritizedReport(raw,p,snapshot,decisions,"vi",JLS_LEGACY_VALIDATOR);
  if (await hybridHash(legacy) !== await hybridHash(o.validated_report)) throw new Error("JLS_PRI_ORIGINAL_VALIDATION_CHANGED");
  const validation = await validatePrioritizedReport(raw,p,snapshot,decisions,"vi",JLS_DISCLOSURE_VALIDATOR);
  if (await hybridHash(reportContent(validation)) !== await hybridHash(reportContent(legacy))) throw new Error("JLS_PRI_REVALIDATION_CONTENT_CHANGED");
  const items = [...validation.report.axes,...validation.report.positive_aspects,...validation.report.negative_aspects,validation.report.conclusion,...validation.report.recommendations];
  const body = { version:JLS_PRI_REVALIDATION_VERSION,run_id:runId,original_result_sha256:original.sha256,
    source_response_sha256:o.response_sha256,source_raw_response_sha256:o.raw_response_sha256,
    source_report_sha256:await hybridHash(raw),source_plan_sha256:await hybridHash(p),snapshot_sha256:await hybridHash(snapshot),
    decisions_sha256:o.decisions_sha256,validator_version:JLS_DISCLOSURE_VALIDATOR,provenance,
    validation,validation_sha256:await hybridHash(validation),controls:{report_validation_passed:items.every(x=>x.status!=="review_needed"),
      remaining_reasons:[...new Set(items.flatMap(x=>x.reasons))],source_content_unchanged:true},
    new_paid_calls:0,human_validated:false,semantic_truth_guaranteed:false,production_enabled:false };
  return {body,sha256:await hybridHash(body)};
}
export type PrioritizedRevalidation = Awaited<ReturnType<typeof buildPrioritizedRevalidation>>;
export async function verifyPrioritizedRevalidation(value: PrioritizedRevalidation, runId:string, original:Original,p:JlsPlan,snapshot:PilotSnapshot,decisions:JlsDecision[]) {
  if (!value?.body || value.body.version!==JLS_PRI_REVALIDATION_VERSION || value.body.validator_version!==JLS_DISCLOSURE_VALIDATOR ||
    await hybridHash(value.body)!==value.sha256) throw new Error("JLS_PRI_REVALIDATION_CHANGED");
  const rebuilt=await buildPrioritizedRevalidation(runId,original,p,snapshot,decisions,value.body.provenance);
  if(rebuilt.sha256!==value.sha256)throw new Error("JLS_PRI_REVALIDATION_CHANGED");
  return value;
}
