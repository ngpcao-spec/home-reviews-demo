import report from "../../docs/pilot-evidence-v3-reserved40-evaluation-20261011.json" with {
  type: "json",
};
import {
  evaluationHash,
  type ReservedEvaluation,
  reservedMetrics,
  type ReservedSource,
  runFrozenV3,
} from "../functions/_shared/pilot-evidence-v3-reserved-evaluation.ts";
const assert = (x: unknown) => {
  if (!x) throw new Error("ASSERTION_FAILED");
};
Deno.test("frozen 40-case output reproduced without network or annotations as input", async () => {
  const r = report.result as unknown as ReservedEvaluation,
    source = {
      control: {
        body: {
          items: r.cases.map((c) => ({ ...c, analysis_text: c.analysis_text })),
        },
      },
    } as unknown as ReservedSource;
  assert(
    await evaluationHash(runFrozenV3(source)) ===
      r.frozen_verifier_outputs_sha256,
  );
  assert(await evaluationHash(r) === report.result_sha256);
  assert(
    r.new_paid_calls === 0 && !r.engine_changed &&
      !r.reference_labels_changed && !r.production_enabled,
  );
});
Deno.test("uncertainty, abstention and zero denominator handled explicitly", () => {
  const r = report.result as unknown as ReservedEvaluation,
    m = reservedMetrics(r.cases);
  assert(
    m.comparable === 36 && m.reference_uncertain === 4 &&
      m.acceptance_precision.denominator === 5 &&
      m.counts.unjustified_accepted === 0,
  );
  assert(m.abstention_all.value === .8);
  assert(reservedMetrics([]).acceptance_precision.value === null);
});
