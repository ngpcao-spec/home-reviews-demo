import { supabase } from "./supabase";
import type { ReservedEvaluation } from "../../supabase/functions/_shared/pilot-evidence-v3-reserved-evaluation";
export interface ReservedEvaluationView {
  record: {
    id: string;
    result: ReservedEvaluation;
    result_sha256: string;
    created_at: string;
  } | null;
  ready: boolean;
  read_only: true;
  new_paid_calls: 0;
  production_enabled: false;
}
export async function reservedEvaluationApi(): Promise<ReservedEvaluationView> {
  if (!supabase) throw new Error("UNAUTHORIZED");
  const { data, error } = await supabase.functions.invoke(
    "jev-pilot-reserved-evaluation",
    { method: "GET" },
  );
  if (error) throw new Error("RESERVED_EVALUATION_READ_FAILED");
  return data as ReservedEvaluationView;
}
