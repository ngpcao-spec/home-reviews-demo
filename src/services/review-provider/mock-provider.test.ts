import { describe, expect, it } from 'vitest'
import { MockReviewProvider } from './mock-provider'

describe('MockReviewProvider',()=>{
  const provider=new MockReviewProvider()
  it('résout un établissement et retourne une fiche normalisée',async()=>{const results=await provider.resolvePlace('Petit Hanoi');expect(results[0]).toMatchObject({name:'Le Petit Hanoi',confidence:.98});expect(results[0].googleMapsUrl).toMatch(/^https:\/\//)})
  it('importe des avis avec un identifiant stable',async()=>{const page=await provider.fetchReviews('mock-le-petit-hanoi',{sort:'newest',limit:1});expect(page.reviews).toHaveLength(1);expect(page.reviews[0].externalReviewId).toContain('mock-le-petit-hanoi')})
})
