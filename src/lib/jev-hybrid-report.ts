import { supabase } from "./supabase";
import type { HybridView } from "../../supabase/functions/_shared/jev-hybrid-api";
export type { HybridView };
export async function hybridReportApi(
  language: "fr" | "vi",
): Promise<HybridView> {
  if (!supabase) throw new Error("UNAUTHORIZED");
  const { data, error } = await supabase.functions.invoke(
    "jev-hybrid-evidence-report?" + new URLSearchParams({ language }),
    { method: "GET" },
  );
  if (error) throw new Error("HYBRID_READ_FAILED");
  return data as HybridView;
}
