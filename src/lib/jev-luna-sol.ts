import { supabase } from "./supabase";
import type { JlsView } from "../../supabase/functions/_shared/jev-luna-sol-api";
export type { JlsView };
export async function jlsPreview(establishment: string, language: "fr" | "vi"): Promise<JlsView> {
  if (!supabase) throw new Error("UNAUTHORIZED");
  const { data, error } = await supabase.functions.invoke("jev-luna-sol-hybrid?" + new URLSearchParams({ establishment_id: establishment, language }), { method: "GET" });
  if (error) {
    let code = "JLS_READ_FAILED";
    if (error.context instanceof Response) {
      try { const body = await error.context.clone().json(); if (typeof body.error === "string") code = body.error; } catch { /* No transport or provider body exposed. */ }
    }
    throw new Error(code);
  }
  return data as JlsView;
}
