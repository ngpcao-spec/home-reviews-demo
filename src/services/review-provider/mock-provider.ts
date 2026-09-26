import type { PlaceCandidate, ReviewPage, ReviewProvider } from './types'

const candidates: PlaceCandidate[] = [
  { placeRef: 'mock-le-petit-hanoi', name: 'Le Petit Hanoi', address: '12 rue de la Paix, Paris', rating: 4.2, reviewCount: 318, googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Le+Petit+Hanoi', confidence: .98 },
  { placeRef: 'mock-saigon-bistro', name: 'Saigon Bistro', address: '8 avenue Parmentier, Paris', rating: 4.5, reviewCount: 186, googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Saigon+Bistro', confidence: .91 },
]

export class MockReviewProvider implements ReviewProvider {
  readonly name = 'mock' as const
  async resolvePlace(input: string) {
    await new Promise((resolve) => setTimeout(resolve, 280))
    const query = input.toLowerCase()
    const matches = candidates.filter((item) => item.name.toLowerCase().includes(query) || query.includes('maps') || item.address.toLowerCase().includes(query))
    return matches.length ? matches : candidates
  }
  async getPlace(placeRef: string) {
    const place = candidates.find((item) => item.placeRef === placeRef)
    if (!place) throw new Error('PLACE_NOT_FOUND')
    return place
  }
  async fetchReviews(placeRef: string, options: { sort: 'newest'; limit: number }): Promise<ReviewPage> {
    const place = await this.getPlace(placeRef)
    return { reviews: [{ externalReviewId: `${placeRef}-${Date.now()}`, authorName: 'Client démo', rating: 2, text: `Une attente beaucoup trop longue chez ${place.name}.`, publishedAt: new Date().toISOString(), sourceUrl: place.googleMapsUrl }].slice(0, options.limit) }
  }
}
