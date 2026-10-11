import { supabase } from "./supabase";
import type { V3View } from "../../supabase/functions/_shared/pilot-evidence-v3-api";
export type { V3View };
export async function evidenceV3Api(audit = false): Promise<V3View> {
  if (!supabase) throw new Error("UNAUTHORIZED");
  const { data, error } = await supabase.functions.invoke(
    "jev-pilot-evidence-v3",
    audit ? { body: { action: "audit_free" } } : { method: "GET" },
  );
  if (error) throw new Error("V3_REQUEST_FAILED");
  return data as V3View;
}
