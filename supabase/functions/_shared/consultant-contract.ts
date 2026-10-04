export const CONSULTANT_VERSION = 5
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
  version: 3 | 4 | 5
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
