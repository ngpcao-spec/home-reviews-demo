import { json, preflight } from "./cors.ts";
import {
  buildV3Audit,
  type V3Audit,
  type V3Base,
  v3Hash,
  verifyV3Audit,
} from "./pilot-evidence-v3-audit.ts";
import {
  exportV3Control,
  selectV3Control,
  type V3Posthoc,
} from "./pilot-evidence-v3-control.ts";
import { V3_VERSION } from "./pilot-evidence-v3.ts";
import type { PilotSnapshot } from "./jev-pilot-core.ts";
export type V3Control = Awaited<ReturnType<typeof selectV3Control>>;
export interface V3Record {
  id: string;
  result: V3Audit;
  result_sha256: string;
  created_at: string;
}
export interface V3View {
  version: string;
  ready: boolean;
  record: V3Record | null;
  control: { id: string; body: V3Control["body"]; sha: string } | null;
  blind_export: ReturnType<typeof exportV3Control> | null;
  new_paid_calls: 0;
  production_enabled: false;
  semantic_paid_enabled: false;
}
export interface V3Repository {
  source: () => Promise<
    {
      snapshot: PilotSnapshot;
      base: V3Base;
      posthoc: V3Posthoc;
      posthoc_sha: string;
    }
  >;
  read: () => Promise<{ record: V3Record | null; control: V3View["control"] }>;
  save: (control: V3Control, audit: V3Audit, sha: string) => Promise<void>;
}
export function v3Handler(
  repository: (request: Request) => Promise<V3Repository>,
) {
  return async (request: Request) => {
    const p = preflight(request);
    if (p) return p;
    try {
      if (!["GET", "POST"].includes(request.method)) {
        return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      }
      const repo = await repository(request), source = await repo.source();
      if (request.method === "POST") {
        const body = await request.json();
        if (body.action !== "audit_free") {
          return json({ error: "V3_PAID_ACTION_DISABLED" }, 405);
        }
        const control = await selectV3Control(
            source.snapshot,
            source.base.result,
            source.posthoc,
            source.posthoc_sha,
          ),
          audit = await buildV3Audit(
            source.snapshot,
            source.base,
            source.posthoc,
            source.posthoc_sha,
            control,
          );
        await verifyV3Audit(
          source.snapshot,
          source.base,
          audit,
          await v3Hash(audit),
          control.sha,
        );
        await repo.save(control, audit, await v3Hash(audit));
      }
      const { record, control } = await repo.read();
      if (record) {
        if (!control || await v3Hash(control.body) !== control.sha) {
          throw new Error("V3_CONTROL_CHANGED");
        }
        await verifyV3Audit(
          source.snapshot,
          source.base,
          record.result,
          record.result_sha256,
          control.sha,
        );
      }
      return json(
        {
          version: V3_VERSION,
          ready: true,
          record,
          control,
          blind_export: control ? exportV3Control(control.body) : null,
          new_paid_calls: 0,
          production_enabled: false,
          semantic_paid_enabled: false,
        } satisfies V3View,
      );
    } catch (e) {
      const error = e instanceof Error && /^[A-Z0-9_]+$/.test(e.message)
        ? e.message
        : "V3_REQUEST_FAILED";
      return json(
        { error },
        error === "UNAUTHORIZED" ? 401 : error === "FORBIDDEN" ? 403 : 409,
      );
    }
  };
}
