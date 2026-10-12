// deno-lint-ignore no-import-prefix
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { json } from "../_shared/cors.ts";
import { loadMultiLaunch, multiPort } from "../_shared/luna-multirest-store.ts";
import { processMultirestBatch } from "../_shared/luna-multirest-worker.ts";
import { MULTI_ORG } from "../_shared/luna-multirest.ts";
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
      "analysis_luna_multirest_runs",
    ).select("id").eq("organization_id", MULTI_ORG).in("status", [
      "queued",
      "running",
    ]);
    if (re) throw new Error("MULTIREST_READ_FAILED");
    if (!runs?.length) return json({ claimed: 0, new_paid_calls: 0 });
    const source = await loadMultiLaunch(admin);
    for (const run of runs) {
      await processMultirestBatch(
        multiPort(admin),
        source,
        run.id,
        Deno.env.get("OPENAI_API_KEY") ?? "",
        fetch,
      );
    }
    return json({ processed_runs: runs.length });
  } catch {
    return json({ error: "MULTIREST_WORKER_STOPPED_NO_RETRY" }, 409);
  }
});
