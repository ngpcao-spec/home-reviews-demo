import { json, preflight } from "./cors.ts";
import {
  MULTI_CONSENT,
  type MultiLaunchView,
} from "./luna-multirest-launch.ts";
import type {
  MultiReferenceInput,
  MultiSet,
  scoreMultirest,
} from "./luna-multirest.ts";
export interface MultiView {
  record:
    | { id: string; body: MultiSet; body_sha256: string; sealed_at: string }
    | null;
  reference_seal: {
    id: string;
    reference_sha256: string;
    sealed_at: string;
    body: MultiReferenceInput;
  } | null;
  blind_export: unknown | null;
  result: ReturnType<typeof scoreMultirest> | null;
  paid_enabled: boolean;
  can_launch: boolean;
  launch?: MultiLaunchView;
  new_paid_calls: 0;
  production_enabled: false;
}
export interface MultiRepository {
  read(): Promise<MultiView>;
  freeze(): Promise<MultiView>;
  seal(input: MultiReferenceInput): Promise<MultiView>;
  prepareLaunch?(view: MultiView): Promise<MultiView>;
  confirmLaunch?(
    view: MultiView,
    body: Record<string, unknown>,
  ): Promise<string>;
  wake?(run: string): void;
}
export function multirestHandler(
  repo: (r: Request) => Promise<MultiRepository>,
) {
  return async (r: Request) => {
    const p = preflight(r);
    if (p) return p;
    try {
      if (!["GET", "POST"].includes(r.method)) {
        return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      }
      const s = await repo(r);
      if (r.method === "GET") return json(await s.read());
      const b = await r.json() as {
        action: string;
        references: MultiReferenceInput;
      };
      if (b.action === "freeze") return json(await s.freeze());
      if (b.action === "seal_references") {
        return json(await s.seal(b.references));
      }
      if (b.action === "prepare_launch" && s.prepareLaunch) {
        return json(await s.prepareLaunch(await s.read()));
      }
      if (b.action === "confirm_launch" && s.confirmLaunch && s.wake) {
        const v = await s.read(),
          m = v.launch,
          body = b as unknown as Record<string, unknown>;
        if (
          !m || !v.reference_seal || !m.plan_id || body.plan_id !== m.plan_id ||
          body.manifest_sha256 !== m.manifest_sha256 ||
          body.estimated_cost_usd !== m.manifest.estimated_cost_usd ||
          body.confirm_cost !== true || body.consent_version !== MULTI_CONSENT
        ) throw new Error("MULTIREST_CONFIRMATION_CHANGED");
        if (!m.api_key_configured && !m.run) {
          throw new Error("DECISIONS_API_KEY_UNAVAILABLE");
        }
        const run = await s.confirmLaunch(v, body);
        s.wake(run);
        return json({
          run_id: run,
          reused: !!m.run,
          new_paid_calls_in_this_request: 0,
        }, 202);
      }
      return json({ error: "MULTIREST_PAID_EXECUTION_DISABLED" }, 405);
    } catch (e) {
      const error = e instanceof Error && /^[A-Z0-9_]+$/.test(e.message)
        ? e.message
        : "MULTIREST_REQUEST_FAILED";
      return json(
        { error },
        error === "UNAUTHORIZED" ? 401 : error === "FORBIDDEN" ? 403 : 409,
      );
    }
  };
}
