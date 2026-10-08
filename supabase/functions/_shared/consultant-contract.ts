import type { StructuredContextStats } from './structured-review-context.ts'
import type { CrossRatingAnalysis } from './cross-rating-analysis.ts'
export const CONSULTANT_VERSION = 7
export const AXES = ['service', 'quality', 'price', 'atmosphere'] as const
export type Axis = typeof AXES[number]
export type AnalyticalSentiment = 'positive' | 'negative'
export interface ConsultantAspect {
  theme_key: string
  axis: Axis
  sentiment: AnalyticalSentiment
  label: string
  mentions: number
  explanation: string
}
export interface ConsultantReportData {
  version: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11
  analysis_engine?:'jev_hybrid'|'jev_hybrid_calibrated'|'jev_hybrid_human_aligned'
  analysis_unavailable_count?:number
  analysis_pipeline?:import('./historical-v9-core.ts').V9Usage&{jev_cost_usd:number;sol_narrative_cost_usd:number;total_estimated_cost_usd:number;end_to_end_elapsed_ms:number|null;unavailable_theme_reviews:number;source_generation_id:string;source_snapshot_sha256:string}
  v8_v9_comparison?:ReturnType<typeof import('./historical-v9-core.ts').compareV8V9>
  calibrated_analysis_pipeline?:ReturnType<typeof import('./historical-v10-core.ts').v10Costs>&{source_generation_id:string;source_snapshot_sha256:string;unavailable_theme_reviews:number}
  v9_v10_comparison?:ReturnType<typeof import('./historical-v10-core.ts').compareV9V10>
  human_aligned_analysis_pipeline?:ReturnType<typeof import('./historical-v11-core.ts').v11Costs>&{source_generation_id:string;source_snapshot_sha256:string;unavailable_theme_reviews:number}
  v11_comparison?:ReturnType<typeof import('./historical-v11-core.ts').compareV11Sources>
  language: 'fr' | 'vi'
  total: number
  positive: number
  negative: number
  axes: { key: Axis; positive: number; negative: number; summary: string; recommendation: string }[]
  positive_aspects: ConsultantAspect[]
  negative_aspects: ConsultantAspect[]
  conclusion: string
  sample_average_rating?: number | null
  axis_diagnostics?: Record<Axis, AxisDiagnostic>
  decision_summary?: DecisionSummary
  structured_context_stats?: StructuredContextStats
  cross_rating_analysis?: CrossRatingAnalysis
  analysis_input_stats?:{total_reviews:number;reviews_with_text:number;textless_reviews:number;original_english_count:number;google_english_translation_count:number;fallback_non_english_count:number;english_analysis_coverage_percent:number}
}

export type CoverageLevel = 'strong' | 'medium' | 'limited'
export type DiagnosticStatus = 'major_strength' | 'strength' | 'watch' | 'priority' | 'limited_data' | 'neutral'
export interface DiagnosticTopic { key:string; axis:Axis; sentiment:AnalyticalSentiment; mentions:number; label:string }
export interface AxisDiagnostic {
  subrating_average:number|null
  subrating_count:number
  coverage_rate:number
  coverage_level:CoverageLevel
  textual_review_count:number
  textual_coverage_rate:number
  status:DiagnosticStatus
  top_positive:DiagnosticTopic[]
  recurring_negative:DiagnosticTopic[]
  isolated_negative:DiagnosticTopic[]
  recurring_threshold:number
  strong_signal_threshold:number
  summary:string
}
export interface DecisionSummary {
  strengths:DiagnosticTopic[]
  watch:DiagnosticTopic[]
  limited_axes:Axis[]
  manager_priorities:DiagnosticTopic[]
  manager_summary:string
}
