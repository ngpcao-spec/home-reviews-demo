import { hybridHash } from "./jev-hybrid-evidence.ts";
import type { validateJlsReport } from "./jev-luna-sol-validation.ts";

export const JLS_REVALIDATION_VERSION = "jls-quote-bound-actions-v1";
export const JLS_REVALIDATION_ACTION = "report_revalidated_quote_bound_v1";
type SolResult = Awaited<ReturnType<typeof validateJlsReport>>;
export interface JlsRevalidation {
  body: {
    version: typeof JLS_REVALIDATION_VERSION;
    run_id: string;
    original_result_sha256: string;
    validator_commit: string;
    new_paid_calls: 0;
    sol_result: SolResult;
  };
  sha256: string;
}
// Events already provide append-only history, service-only writes and org-scoped RLS.
// Never change the run status or replace the original result.
export async function verifyJlsRevalidation(
  value: JlsRevalidation, runId: string,
  original: { body: { sol_result: SolResult }; result_sha256: string },
) {
  const b = value?.body, next = b?.sol_result, previous = original.body.sol_result;
  if (!b || b.version !== JLS_REVALIDATION_VERSION || b.run_id !== runId ||
    b.original_result_sha256 !== original.result_sha256 || b.new_paid_calls !== 0 ||
    !/^[a-f0-9]{40}$/.test(b.validator_commit) || !next ||
    await hybridHash(b) !== value.sha256 || await hybridHash(original.body) !== original.result_sha256)
    throw new Error("JLS_REVALIDATION_CHANGED");
  // This revision only rechecks recommendations; all other evidence and output stay frozen.
  const { report: nextReport, ...nextRest } = next;
  const { report: oldReport, ...oldRest } = previous;
  const { recommendations: nextActions, ...nextSections } = nextReport;
  const { recommendations: oldActions, ...oldSections } = oldReport;
  if (await hybridHash(nextRest) !== await hybridHash(oldRest) ||
    await hybridHash(nextSections) !== await hybridHash(oldSections) ||
    nextActions.length !== oldActions.length || nextActions.some((a, i) =>
      a.axis !== oldActions[i].axis || a.action_code !== oldActions[i].action_code || JSON.stringify(a.evidence_ids) !== JSON.stringify(oldActions[i].evidence_ids)))
    throw new Error("JLS_REVALIDATION_SCOPE_CHANGED");
  return value;
}
