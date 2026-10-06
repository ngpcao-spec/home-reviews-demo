export type PreferredLanguage='fr'|'vi'
export type ProviderLanguage='en'|PreferredLanguage
export type GoogleReviewFetchLanguage='en'
export const GOOGLE_REVIEWS_IMPORT_LANGUAGE:GoogleReviewFetchLanguage='en'
export function normalizeReviewLanguage(value:string|null|undefined):string|null {return value?.trim().toLowerCase().replaceAll('_','-').split('-')[0]||null}
export function translationLanguage(value:string|null|undefined):ProviderLanguage|null {
  const language=normalizeReviewLanguage(value)
  return language==='en'||language==='fr'||language==='vi'?language:null
}
