// Explicit synthetic responses for browser tests only; never application data.
import { prioritizedFixture } from "../tests/fixtures/jev-luna-sol-prioritized.ts";
import { validatePrioritizedReport } from "../supabase/functions/_shared/jev-luna-sol-prioritized-validation.ts";
const views: Record<string, unknown> = {};
for (const language of ["fr", "vi"] as const) {
  const f = await prioritizedFixture(language);
  views[language] = { simulated_test_fixture: true, draft: f.draft,
    result: await validatePrioritizedReport(f.raw, f.p, f.snapshot, f.decisions) };
}
await Deno.writeTextFile("tests/e2e/fixtures/jls-prioritized.json", JSON.stringify({ simulated_test_fixture: true, views }));
