import type { PreferredLanguage } from '../types/domain'

export interface StoredReviewTranslation {
  language: PreferredLanguage
  translated_text: string
}

export function localizedReviewText(
  originalText: string,
  translations: StoredReviewTranslation[] | null | undefined,
  preferredLanguage: PreferredLanguage,
) {
  const translatedText = translations?.find((item) => item.language === preferredLanguage)?.translated_text?.trim()
  return { originalText, translatedText: translatedText || undefined, displayText: translatedText || originalText }
}
