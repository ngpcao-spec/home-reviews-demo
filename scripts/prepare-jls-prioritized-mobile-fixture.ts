// Explicit synthetic responses for browser tests only; never application data.
import { prioritizedFixture } from "../tests/fixtures/jev-luna-sol-prioritized.ts";
import { validatePrioritizedReport } from "../supabase/functions/_shared/jev-luna-sol-prioritized-validation.ts";
import { prioritizedExecutionFixture } from "../tests/fixtures/jls-prioritized-execution.ts";
import { processPrioritizedSol } from "../supabase/functions/_shared/jls-prioritized-worker.ts";
const views: Record<string, unknown> = {};
for (const language of ["fr", "vi"] as const) {
  const f = await prioritizedFixture(language);
  views[language] = { simulated_test_fixture: true, draft: f.draft,
    result: await validatePrioritizedReport(f.raw, f.p, f.snapshot, f.decisions) };
}
await Deno.writeTextFile("tests/e2e/fixtures/jls-prioritized.json", JSON.stringify({ simulated_test_fixture: true, views }));
const mock=await prioritizedExecutionFixture();await mock.authorize();
await processPrioritizedSol(mock.port,mock.source,mock.task.run_id,"explicit_mock_key",mock.http);
await Deno.writeTextFile("tests/e2e/fixtures/jls-prioritized-execution.json",JSON.stringify({simulated_test_fixture:true,
  protocol:mock.protocol,run:{id:mock.task.run_id,status:mock.read().state,expires_at:mock.read().consent!.expires_at,consent_source:"explicit_mock_only",error_code:null},
  task:{status:mock.task.status,request_count:mock.task.request_count,error_code:null},
  result:{body:mock.read().result,sha256:await import("../supabase/functions/_shared/jev-hybrid-evidence.ts").then(m=>m.hybridHash(mock.read().result))}}));
