import { json, preflight } from "../_shared/cors.ts";
// No scheduler is installed. No provider or API-key dependency is reachable.
Deno.serve((request) =>
  preflight(request) ??
    json({ error: "HYBRID_PAID_EXECUTION_DISABLED", new_paid_calls: 0 }, 403)
);
