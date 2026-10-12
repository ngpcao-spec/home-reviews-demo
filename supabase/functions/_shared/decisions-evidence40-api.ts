import { json, preflight } from "./cors.ts";
import type { E40View } from "./decisions-evidence40.ts";
export interface E40ApiPort {
  authorize(r: Request): Promise<void>;
  view(): Promise<E40View>;
  prepare(v: E40View): Promise<string>;
  confirm(v: E40View, body: Record<string, unknown>): Promise<string>;
  wake(run: string): void;
}
export function evidence40Handler(port: (r: Request) => Promise<E40ApiPort>) {
  return async (r: Request) => {
    const p = preflight(r);
    if (p) return p;
    try {
      if (!["GET", "POST"].includes(r.method)) {
        return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      }
      const api = await port(r);
      await api.authorize(r);
      const v = await api.view();
      if (r.method === "GET") return json(v);
      const body = await r.json() as Record<string, unknown>;
      if (body.action === "prepare") {
        return json({ ...v, plan_id: await api.prepare(v) });
      }
      if (body.action !== "confirm") {
        return json({ error: "DECISIONS_CHOICE_PREDICATE_LOCKED" }, 405);
      }
      if (
        body.consent_version !== "evidence40-cost-confirmation-v1" ||
        body.confirm_cost !== true ||
        body.manifest_sha256 !== v.manifest_sha256 ||
        body.plan_id !== v.plan_id || !v.plan_id ||
        body.estimated_cost_usd !== v.manifest.estimated_cost_usd
      ) throw new Error("EVIDENCE40_CONFIRMATION_CHANGED");
      if (!v.api_key_configured && !v.run) {
        throw new Error("DECISIONS_API_KEY_UNAVAILABLE");
      }
      const run = await api.confirm(v, body);
      // Only this explicit app confirmation can wake the worker. Reads and free preparation cannot.
      api.wake(run);
      return json({
        run_id: run,
        reused: !!v.run,
        new_paid_calls_in_this_request: 0,
      }, 202);
    } catch (e) {
      const error = e instanceof Error && /^[A-Z_0-9]+$/.test(e.message)
        ? e.message
        : "EVIDENCE40_REQUEST_FAILED";
      return json(
        { error },
        error === "UNAUTHORIZED" ? 401 : error === "FORBIDDEN" ? 403 : 409,
      );
    }
  };
}
