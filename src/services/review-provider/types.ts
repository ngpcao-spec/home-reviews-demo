export interface PlaceCandidate {
  placeRef: string
  name: string
  address: string
  rating: number
  reviewCount: number
  googleMapsUrl: string
  photoUrl?: string
  confidence: number
}

export interface ProviderReview {
  externalReviewId: string
  authorName: string
  rating: number
  text: string
  publishedAt: string
  sourceUrl: string
}

export interface ReviewPage { reviews: ProviderReview[]; nextCursor?: string }

export interface ReviewProvider {
  readonly name: 'outscraper' | 'serpapi' | 'mock'
  resolvePlace(input: string): Promise<PlaceCandidate[]>
  getPlace(placeRef: string): Promise<PlaceCandidate>
  fetchReviews(placeRef: string, options: { sort: 'newest'; limit: number; since?: string }): Promise<ReviewPage>
}
