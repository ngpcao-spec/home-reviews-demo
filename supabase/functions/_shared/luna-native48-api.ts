import { json, preflight } from "./cors.ts";
import type { NativeView } from "./luna-native48.ts";
export interface NativeApiPort {
  authorize(): Promise<void>;
  view(): Promise<NativeView>;
  prepare(v: NativeView): Promise<string>;
}
export function native48Handler(
  repository: (r: Request) => Promise<NativeApiPort>,
) {
  return async (r: Request) => {
    const p = preflight(r);
    if (p) return p;
    try {
      if (!["GET", "POST"].includes(r.method)) {
        return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      }
      const api = await repository(r);
      await api.authorize();
      const v = await api.view();
      if (r.method === "GET") return json(v);
      const body = await r.json();
      if (body.action !== "prepare") {
        return json({ error: "NATIVE48_ADMIN_DELEGATION_REQUIRED" }, 405);
      }
      return json({ ...v, plan_id: await api.prepare(v) });
    } catch (e) {
      const error = e instanceof Error && /^[A-Z_0-9]+$/.test(e.message)
        ? e.message
        : "NATIVE48_REQUEST_FAILED";
      return json(
        { error },
        error === "UNAUTHORIZED" ? 401 : error === "FORBIDDEN" ? 403 : 409,
      );
    }
  };
}
