import { json, preflight } from "./cors.ts";
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
  paid_enabled: false;
  can_launch: false;
  new_paid_calls: 0;
  production_enabled: false;
}
export interface MultiRepository {
  read(): Promise<MultiView>;
  freeze(): Promise<MultiView>;
  seal(input: MultiReferenceInput): Promise<MultiView>;
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
