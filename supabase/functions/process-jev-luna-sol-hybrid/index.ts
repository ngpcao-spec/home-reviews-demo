import { json, preflight } from "../_shared/cors.ts";
// Closed independently of environment flags, secrets or older consents.
// No scheduler registration and no provider dependency in this preparation.
Deno.serve(r => preflight(r) ?? json({ error: "JLS_PAID_EXECUTION_DISABLED", new_paid_calls: 0 }, 403));
