import type { JevRun,JevComparison,AxisScores } from './jev-benchmark'
export interface ThemeMetrics extends AxisScores {support_sol_v6:number;support_level:'high'|'medium'|'low'|'none';sufficient_support:boolean;tp:number;tn:number;fp:number;fn:number;agreement_with_sol_v6:number|null}
export interface ThemeAxisMetrics {positive_micro_f1:number|null;negative_micro_f1:number|null;global_micro_f1:number|null;supported_labels:number;positive_supported_labels:number;negative_supported_labels:number}
export interface JevThemeComparison {
  benchmark_type:'themes_phase2';metrics_complete:boolean;catalog:string[];theme_axes:Record<string,string>
  dataset:JevComparison['dataset'];jev:JevComparison['jev'] & {individual_http_requests:{p50_ms:number|null;p95_ms:number|null;max_ms:number|null}}
  sol_v6_baseline:JevComparison['sol_v6_baseline']
  micro_f1_all_supported_themes:number|null;macro_f1_supported_themes:number|null;supported_labels:number
  axis_metrics:Record<string,ThemeAxisMetrics>
  theme_metrics:Record<string,Record<string,Record<'positive'|'negative',ThemeMetrics>>>
  best_benchmark_threshold:Record<string,{threshold:number;f1_vs_sol_reference:number}|null>
  threshold_comparison:Record<string,{micro_f1_all_supported_themes:number|null;macro_f1_supported_themes:number|null;supported_labels:number}>
  stability:{exact_theme_choice_stability_rate:number|null;mean_probability_drift:number|null;p95_probability_drift:number|null;max_probability_drift:number|null;by_axis:Record<string,{exact_theme_choice_stability_rate:number|null;mean_probability_drift:number|null;p95_probability_drift:number|null;max_probability_drift:number|null}>}
  verdict:{quality:'excellent'|'prometteur'|'insuffisant'|'not_evaluable';weak_axes:string[];cost:string;latency:string;next_step:string}
  errors?:JevComparison['errors']
}
export type JevThemeRun=JevRun<JevThemeComparison>
