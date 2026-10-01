export const CONSULTANT_VERSION = 3
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
  version: 3
  language: 'fr' | 'vi'
  total: number
  positive: number
  negative: number
  axes: { key: Axis; positive: number; negative: number; summary: string; recommendation: string }[]
  positive_aspects: ConsultantAspect[]
  negative_aspects: ConsultantAspect[]
  conclusion: string
}
