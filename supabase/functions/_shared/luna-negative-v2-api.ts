import { json, preflight } from "./cors.ts";
import type { NegReferenceInput, NegSet } from "./luna-negative-v2.ts";
import {
  type NegativeLaunchView,
  NV2_CONSENT,
} from "./luna-negative-v2-launch.ts";
export interface NegativeView {
  record:
    | { id: string; body: NegSet; body_sha256: string; sealed_at: string }
    | null;
  reference_seal: {
    id: string;
    reference_sha256: string;
    body: NegReferenceInput;
    sealed_at: string;
  } | null;
  blind_export: unknown;
  paid_enabled: false;
  new_paid_calls: 0;
  launch?: NegativeLaunchView;
}
export interface NegativeRepository {
  read(): Promise<NegativeView>;
  freeze(): Promise<NegativeView>;
  seal(input: NegReferenceInput): Promise<NegativeView>;
  prepareLaunch?(view: NegativeView): Promise<NegativeView>;
  confirmLaunch?(
    view: NegativeView,
    body: Record<string, unknown>,
  ): Promise<string>;
  wake?(run: string): void;
}
export function negativeHandler(
  repository: (r: Request) => Promise<NegativeRepository>,
) {
  return async (r: Request) => {
    const p = preflight(r);
    if (p) return p;
    try {
      if (!["GET", "POST"].includes(r.method)) {
        return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      }
      const repo = await repository(r);
      if (r.method === "GET") return json(await repo.read());
      const body = await r.json();
      if (body.action === "freeze") return json(await repo.freeze());
      if (body.action === "seal_references") {
        return json(await repo.seal(body.references));
      }
      if (body.action === "prepare_launch" && repo.prepareLaunch) {
        return json(await repo.prepareLaunch(await repo.read()));
      }
      if (body.action === "confirm_launch" && repo.confirmLaunch && repo.wake) {
        const v = await repo.read(), l = v.launch;
        if (
          !l || !v.reference_seal || !l.plan_id || body.plan_id !== l.plan_id ||
          body.manifest_sha256 !== l.manifest_sha256 ||
          body.estimated_cost_usd !== l.manifest.estimated_cost_usd ||
          body.confirm_cost !== true || body.consent_version !== NV2_CONSENT
        ) throw new Error("NEGATIVE_V2_CONFIRMATION_CHANGED");
        if (!l.api_key_configured && !l.run) {
          throw new Error("DECISIONS_API_KEY_UNAVAILABLE");
        }
        const run = await repo.confirmLaunch(v, body);
        repo.wake(run);
        return json({
          run_id: run,
          reused: !!l.run,
          new_paid_calls_in_this_request: 0,
        }, 202);
      }
      return json({ error: "NEGATIVE_V2_PAID_EXECUTION_DISABLED" }, 405);
    } catch (e) {
      const error = e instanceof Error && /^[A-Z0-9_]+$/.test(e.message)
        ? e.message
        : "NEGATIVE_V2_REQUEST_FAILED";
      return json(
        { error },
        error === "UNAUTHORIZED" ? 401 : error === "FORBIDDEN" ? 403 : 409,
      );
    }
  };
}
