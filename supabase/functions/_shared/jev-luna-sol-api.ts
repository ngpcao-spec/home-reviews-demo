import type { JlsRevalidation } from "./jev-luna-sol-revalidation.ts";
import { json, preflight } from "./cors.ts";
import { hybridHash } from "./jev-hybrid-evidence.ts";
import type { JlsPlan } from "./jev-luna-sol.ts";
import type { delegatedProtocol, executionCosts, JlsExecutionTask } from "./jev-luna-sol-delegation.ts";
import type { acceptedSolDossier } from "./jev-luna-sol.ts";
import type { validateJlsReport } from "./jev-luna-sol-validation.ts";
export interface JlsView {
  plan: { id: string; body: JlsPlan; result_sha256: string; created_at: string } | null;
  runs: { id: string; status: string }[];
  paid_enabled: false; production_enabled: false; new_paid_calls: 0;
  delegated?: {
    ready: boolean; plan_id: string;
    protocol: { body: Awaited<ReturnType<typeof delegatedProtocol>>; sha256: string } | null;
    run: {id:string;status:string;consent_source:string;consent_sha256:string;expires_at:string;gate:Record<string,unknown>|null;error_code:string|null} | null;
    tasks: JlsExecutionTask[];
    dossier: {body:Awaited<ReturnType<typeof acceptedSolDossier>>;sha256:string}|null;
    result: {body:{sol_result:Awaited<ReturnType<typeof validateJlsReport>>};result_sha256:string}|null;
    revalidation?: JlsRevalidation | null;
    costs:ReturnType<typeof executionCosts>;
  };
}
export function jlsHandler(read: (r: Request) => Promise<JlsView>) {
  return async (r: Request) => {
    const p = preflight(r); if (p) return p;
    if (r.method !== "GET") return json({ error: "JLS_PAID_EXECUTION_DISABLED" }, 405);
    try {
      const view = await read(r);
      if (view.paid_enabled !== false || view.production_enabled !== false || view.new_paid_calls !== 0 ||
        view.plan && await hybridHash(view.plan.body) !== view.plan.result_sha256) throw new Error("JLS_PLAN_CHANGED");
      return json(view);
    } catch (e) {
      const error = e instanceof Error && /^[A-Z0-9_]+$/.test(e.message) ? e.message : "JLS_READ_FAILED";
      return json({ error }, error === "UNAUTHORIZED" ? 401 : error === "FORBIDDEN" ? 403 : 409);
    }
  };
}
