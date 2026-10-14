// Administrative FREE artifact preparation. No fetch, credentials, job or consent.
// Inputs are read-only exports of the existing plan, snapshot and native verdicts.
import { buildPrioritizedDraft } from "../supabase/functions/_shared/jev-luna-sol-prioritized.ts";
import { verifyJlsPlan } from "../supabase/functions/_shared/jev-luna-sol.ts";
import { hybridHash } from "../supabase/functions/_shared/jev-hybrid-evidence.ts";
import { validateJlsReport } from "../supabase/functions/_shared/jev-luna-sol-validation.ts";
import { PILOT_AXES } from "../supabase/functions/_shared/jev-pilot-core.ts";
const [inputPath, outputPath] = Deno.args;
if (!inputPath || !outputPath) throw new Error("JLS_PREPARATION_INPUT_REQUIRED");
const input = JSON.parse(await Deno.readTextFile(inputPath));
await verifyJlsPlan(input.p, input.source, input.snapshot);
await validateJlsReport({ statistics_sha256: input.p.statistics_sha256, report: {
  axes: PILOT_AXES.map(axis => ({ axis, text: "Preparation only.", evidence_ids: [] })),
  positive_aspects: [], negative_aspects: [], conclusion: { text: "Preparation only.", evidence_ids: [] }, recommendations: [],
} }, input.p, input.snapshot, input.decisions);
const artifacts = [];
for (const language of ["fr", "vi"] as const) {
  const draft = await buildPrioritizedDraft(input.p, input.decisions, language), body = {
    version: draft.version, language, organization_id: input.p.organization_id,
    source_plan_id: "5295245f-b2c1-4f5d-80ad-ca9f821ae3da", source_plan_sha256: await hybridHash(input.p),
    source_run_id: "489d42ae-c44c-40c1-8435-16f304c71a9e", source_result_sha256: input.source_result_sha256,
    execution_authorized: false, draft,
  };
  artifacts.push({ body, sha256: await hybridHash(body) });
  console.log(JSON.stringify({ language, accepted: draft.accepted_ids.length, rejected: draft.rejected_ids.length, estimates: draft.estimates,
    request_sha256: draft.request_sha256, dossier_sha256: draft.dossier_sha256, sha256: await hybridHash(body) }));
}
await Deno.writeTextFile(outputPath, JSON.stringify(artifacts));
