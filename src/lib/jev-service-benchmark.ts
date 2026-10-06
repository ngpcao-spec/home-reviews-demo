import type { JevRun } from './jev-benchmark'
import type { JevThemeComparison } from './jev-theme-benchmark'
export interface ServiceTarget {support_sol_v6:number;phase2_f1:number|null;phase2b_f1:number|null;absolute_difference:number|null;phase2_precision:number|null;phase2_recall:number|null;precision_vs_sol_reference:number|null;recall_vs_sol_reference:number|null}
export interface JevServiceComparison extends Omit<JevThemeComparison,'benchmark_type'|'verdict'|'stability'> {
  benchmark_type:'themes_phase2b_service';question_set_version:string
  service_micro_f1_supported:number|null;service_positive_micro_f1:number|null;service_negative_micro_f1:number|null
  phase2_comparison:{comparable:boolean;reason:string|null;benchmark_id:string|null;source_generation_id:string|null;phase2_service_micro_f1:number|null;phase2b_service_micro_f1:number|null;absolute_difference:number|null;phase2_cost_usd:number|null;phase2_elapsed_ms:number|null;target_themes:Record<string,ServiceTarget>;non_regression:Record<string,{assessed:boolean;phase2_f1:number|null;phase2b_f1:number|null;passed:boolean|null}>}
  stability:JevThemeComparison['stability'] & {by_theme:Record<string,{exact_theme_choice_stability_rate:number|null;mean_probability_drift:number|null;p95_probability_drift:number|null;max_probability_drift:number|null}>}
  verdict:{quality:'SUCCESS'|'VERY_GOOD'|'NEEDS_REVIEW';non_regression_passed:boolean;target_support_sufficient:boolean;next_step:string}
}
export type JevServiceRun=JevRun<JevServiceComparison>
