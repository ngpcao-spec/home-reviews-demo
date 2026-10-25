export type PreferredLanguage='fr'|'vi'
export type ProviderLanguage='en'|PreferredLanguage
export type GoogleReviewFetchLanguage=PreferredLanguage
export function collectionLanguage(value:unknown):PreferredLanguage{
 if(value!=='fr'&&value!=='vi')throw Error('COLLECTION_LANGUAGE_REQUIRED')
 return value
}
export function normalizeReviewLanguage(value:string|null|undefined):string|null {return value?.trim().toLowerCase().replaceAll('_','-').split('-')[0]||null}
export function translationLanguage(value:string|null|undefined):ProviderLanguage|null {
  const language=normalizeReviewLanguage(value)
  return language==='en'||language==='fr'||language==='vi'?language:null
}
