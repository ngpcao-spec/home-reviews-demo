import { json, preflight } from "./cors.ts";
import type { NegReferenceInput, NegSet } from "./luna-negative-v2.ts";
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
}
export interface NegativeRepository {
  read(): Promise<NegativeView>;
  freeze(): Promise<NegativeView>;
  seal(input: NegReferenceInput): Promise<NegativeView>;
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
