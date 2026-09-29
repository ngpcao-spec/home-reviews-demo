import { describe, expect, it } from 'vitest'
import { localizedReviewText } from './review-translation'

const original = 'Очень медленное обслуживание.'
const translations = [
  { language: 'fr' as const, translated_text: 'Service très lent.' },
  { language: 'vi' as const, translated_text: 'Phục vụ rất chậm.' },
]

describe('localizedReviewText', () => {
  it('uses the requested translation without changing the original', () => {
    expect(localizedReviewText(original, translations, 'fr')).toEqual({
      originalText: original,
      translatedText: 'Service très lent.',
      displayText: 'Service très lent.',
    })
    expect(localizedReviewText(original, translations, 'vi')).toEqual({
      originalText: original,
      translatedText: 'Phục vụ rất chậm.',
      displayText: 'Phục vụ rất chậm.',
    })
  })

  it('falls back honestly to the original when a translation is absent', () => {
    expect(localizedReviewText(original, null, 'vi').displayText).toBe(original)
  })
})
