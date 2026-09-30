export interface AutomaticAnalysisReview {
  rating: number
  historical_import: boolean
  text?: string | null
  original_text?: string | null
  negative_feedback_checked_at?: string | null
}

export function shouldAutomaticallyAnalyzeReview(review: AutomaticAnalysisReview): boolean {
  if (review.historical_import || !Number.isInteger(review.rating)) return false
  if (review.rating >= 1 && review.rating <= 3) return true
  if (review.rating !== 4 || review.negative_feedback_checked_at) return false
  return Boolean((review.original_text || review.text || '').trim())
}
