import type { PreferredLanguage } from '../types/domain'
export type ReviewTranslationLanguage=PreferredLanguage|'en'

export interface StoredReviewTranslation {
  language: ReviewTranslationLanguage
  translated_text: string
}

export function localizedReviewText(
  originalText: string,
  translations: StoredReviewTranslation[] | null | undefined,
  preferredLanguage: PreferredLanguage,
) {
  const translatedText = translations?.find((item) => item.language === preferredLanguage && item.translated_text?.trim())?.translated_text?.trim()
    || translations?.find(item=>item.language==='en' && item.translated_text?.trim())?.translated_text?.trim()
  return { originalText, translatedText: translatedText || undefined, displayText: translatedText || originalText }
}
