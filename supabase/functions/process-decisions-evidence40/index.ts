// Pinned to the existing project runtime.
// deno-lint-ignore no-import-prefix
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { json } from "../_shared/cors.ts";
import {
  evidence40Port,
  loadEvidence40,
} from "../_shared/decisions-evidence40-store.ts";
import { processEvidence40Batch } from "../_shared/decisions-evidence40-worker.ts";
Deno.serve(async (r) => {
  if (r.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const { data: allowed, error } = await admin.rpc(
    "verify_review_scheduler_token",
    { p_token: r.headers.get("x-home-reviews-scheduler") ?? "" },
  );
  if (error || allowed !== true) return json({ error: "UNAUTHORIZED" }, 401);
  try {
    const { data: runs, error: re } = await admin.from(
      "analysis_decisions_evidence40_runs",
    ).select("id").in("status", ["queued", "running"]);
    if (re) throw new Error("EVIDENCE40_READ_FAILED");
    if (!runs?.length) return json({ claimed: 0, new_paid_calls: 0 });
    const m = await loadEvidence40(admin);
    for (const run of runs) {
      await processEvidence40Batch(
        evidence40Port(admin),
        m,
        run.id,
        Deno.env.get("OPENAI_API_KEY") ?? "",
        fetch,
      );
    }
    return json({ processed_runs: runs.length });
  } catch {
    return json({ error: "EVIDENCE40_WORKER_STOPPED_NO_RETRY" }, 409);
  }
});
