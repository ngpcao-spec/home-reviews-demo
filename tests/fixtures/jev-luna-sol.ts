import { hybridFixture } from "./jev-hybrid";
import { buildBalancedPlan } from "../../supabase/functions/_shared/jev-hybrid-balanced";
import { hybridHash, HYBRID_ACTIONS } from "../../supabase/functions/_shared/jev-hybrid-evidence";
import { buildJlsPlan, type JlsPlan } from "../../supabase/functions/_shared/jev-luna-sol";
import { PILOT_AXES } from "../../supabase/functions/_shared/jev-pilot-core";
export async function jlsFixture(language: "fr" | "vi" = "fr") {
  const f = await hybridFixture(language), balanced = await buildBalancedPlan(f.snapshot, f.cache, [], language, f.plan);
  const source = { id: "explicit-synthetic-test-source", body: balanced, result_sha256: await hybridHash(balanced) };
  return { ...f, source, jls: await buildJlsPlan(source, f.snapshot, language) };
}
export function mockJlsLuna(group: JlsPlan["luna_groups"][number], choice = "supported", confidence = .9) {
  return { model: "gpt-6-luna", usage: { input_tokens: 100, output_tokens: 0, total_tokens: 100 },
    answers: group.evidence_ids.map(name => ({ name, type: "choice", choice, confidence,
      probabilities: ["supported", "unsupported", "uncertain"].map(value => ({ value, probability: value === choice ? .96 : .02 })) })) };
}
export function mockJlsReport(p: JlsPlan, acceptedIds: string[]) {
  return { statistics_sha256: p.statistics_sha256, report: {
    axes: PILOT_AXES.map(axis => ({ axis, text: "Consulter les preuves de cet axe.",
      evidence_ids: p.selected.filter(e => acceptedIds.includes(e.evidence_id) && e.axis === axis).slice(0,1).map(e => e.evidence_id) })),
    positive_aspects: [], negative_aspects: [],
    conclusion: { text: "La couverture reste limitée.", evidence_ids: acceptedIds.slice(0,1) }, recommendations: [],
  } };
}
export const mockAction = HYBRID_ACTIONS;
