export interface AutomaticAnalysisReview {
  rating: number
  historical_import: boolean
}

export function shouldAutomaticallyAnalyzeReview(review: AutomaticAnalysisReview): boolean {
  return !review.historical_import
    && Number.isInteger(review.rating)
    && review.rating >= 1
    && review.rating <= 3
}
