import { json, preflight } from "./cors.ts";
import { negativeHash } from "./negative-validation-core.ts";
import { canonicalJson } from "./jev-exploratory-core.ts";
import type { DecisionsPreparation } from "./decisions-preparation.ts";
export interface DecisionsView {
  record: {
    id: string;
    body: DecisionsPreparation;
    result_sha256: string;
    created_at: string;
  } | null;
  paid_enabled: false;
  production_enabled: false;
  new_paid_calls: 0;
}
export function decisionsHandler(read: (r: Request) => Promise<DecisionsView>) {
  return async (r: Request) => {
    const p = preflight(r);
    if (p) return p;
    try {
      if (r.method !== "GET") {
        return json({ error: "DECISIONS_PAID_EXECUTION_DISABLED" }, 405);
      }
      const v = await read(r);
      if (
        v.record &&
        await negativeHash(canonicalJson(v.record.body)) !==
          v.record.result_sha256
      ) throw new Error("DECISIONS_PREPARATION_CHANGED");
      return json(v);
    } catch (e) {
      const error = e instanceof Error && /^[A-Z_]+$/.test(e.message)
        ? e.message
        : "DECISIONS_READ_FAILED";
      return json(
        { error },
        error === "UNAUTHORIZED" ? 401 : error === "FORBIDDEN" ? 403 : 409,
      );
    }
  };
}
