import {fetchOutscraperGoogleReviews} from './outscraper.ts'
import {fetchApifyReviews, type ProviderLanguage} from './apify.ts'
import {GOOGLE_REVIEWS_IMPORT_LANGUAGE} from './review-language.ts'

export interface PlaceCandidate{placeRef:string;name:string;address:string;rating:number;reviewCount:number;googleMapsUrl:string;photoUrl?:string;confidence:number}
export interface ProviderReview{externalReviewId:string;authorName:string;authorAvatarUrl?:string;rating:number;text:string;translatedText?:string;language?:string;translatedLanguage?:string;publishedAt:string;sourceUrl:string;ownerResponse?:string}
export interface ReviewPage{reviews:ProviderReview[];nextCursor?:string}
export interface ReviewProvider{readonly name:'apify'|'outscraper'|'serpapi'|'mock';resolvePlace(input:string,language?:ProviderLanguage):Promise<PlaceCandidate[]>;getPlace(placeRef:string,language?:ProviderLanguage):Promise<PlaceCandidate>;fetchReviews(placeRef:string,options:{sort:'newest'|'lowest_rating';limit?:number;since?:string;cursor?:string;language?:ProviderLanguage}):Promise<ReviewPage>}

const mockPlaces:PlaceCandidate[]=[
  {placeRef:'mock-le-petit-hanoi',name:'Le Petit Hanoi',address:'12 rue de la Paix, Paris',rating:4.2,reviewCount:318,googleMapsUrl:'https://www.google.com/maps/search/?api=1&query=Le+Petit+Hanoi',confidence:.98},
  {placeRef:'mock-saigon-bistro',name:'Saigon Bistro',address:'8 avenue Parmentier, Paris',rating:4.5,reviewCount:186,googleMapsUrl:'https://www.google.com/maps/search/?api=1&query=Saigon+Bistro',confidence:.91},
]
export class MockReviewProvider implements ReviewProvider{readonly name='mock' as const;async resolvePlace(input:string){const q=input.toLowerCase();const matches=mockPlaces.filter(p=>p.name.toLowerCase().includes(q)||p.address.toLowerCase().includes(q));return(matches.length?matches:mockPlaces).slice(0,5)}async getPlace(ref:string){const place=mockPlaces.find(p=>p.placeRef===ref);if(!place)throw new Error('PLACE_NOT_FOUND');return place}async fetchReviews(ref:string,{limit}:{limit:number}){const place=await this.getPlace(ref);return{reviews:Array.from({length:Math.min(limit,8)},(_,i)=>({externalReviewId:`${ref}-${i}`,authorName:['Camille','Minh','Sophie','Julien'][i%4],rating:[1,2,3,5][i%4],text:['Attente beaucoup trop longue sans explication.','La salle manquait de propreté.','Bonne cuisine mais service vraiment lent.','Très belle expérience, merci !'][i%4],publishedAt:new Date(Date.now()-i*86400000).toISOString(),sourceUrl:place.googleMapsUrl}))}}}

async function fetchJson(url:string,init:RequestInit={},timeout=12000){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);try{const response=await fetch(url,{...init,signal:controller.signal});if(response.status===429)throw new Error('PROVIDER_RATE_LIMIT');if(!response.ok)throw new Error(`PROVIDER_HTTP_${response.status}`);return await response.json()}finally{clearTimeout(timer)}}
async function withRetry<T>(fn:()=>Promise<T>,attempts=2){let last:unknown;for(let i=0;i<attempts;i++){try{return await fn()}catch(error){last=error;if(i<attempts-1)await new Promise(r=>setTimeout(r,250*2**i))}}throw last}

export class OutscraperReviewProvider implements ReviewProvider{
  readonly name='outscraper' as const;constructor(private key:string){}
  async resolvePlace(input:string){const result=await fetchOutscraperGoogleReviews({query:input,apiKey:this.key,reviewsLimit:1});const place=result.establishment;return[{placeRef:place.googleId,name:place.name,address:place.fullAddress,rating:place.rating,reviewCount:place.totalReviews,googleMapsUrl:place.locationLink??input,photoUrl:place.photo??undefined,confidence:.9}]}
  async getPlace(placeRef:string){const found=await this.resolvePlace(placeRef);if(!found[0])throw new Error('PLACE_NOT_FOUND');return found[0]}
  async fetchReviews(placeRef:string,{limit}:{limit:number}){const result=await fetchOutscraperGoogleReviews({query:placeRef,apiKey:this.key,reviewsLimit:limit});return{reviews:result.reviews.map(review=>({externalReviewId:review.externalReviewId,authorName:review.authorName,authorAvatarUrl:review.authorImage??undefined,rating:review.rating,text:review.text,publishedAt:review.publishedAt??new Date(0).toISOString(),sourceUrl:review.reviewUrl??result.establishment.locationLink??'https://maps.google.com'}))}}
}

export class ApifyReviewProvider implements ReviewProvider{
  readonly name='apify' as const
  constructor(private token:string){}
  async resolvePlace(input:string,language:ProviderLanguage='en'){
    const result=await fetchApifyReviews(this.token,{placeUrl:input,language:GOOGLE_REVIEWS_IMPORT_LANGUAGE,sort:'newest',limit:1})
    const place=result.establishment
    return[{placeRef:place.googleId,name:place.name,address:place.fullAddress,rating:place.rating,reviewCount:place.totalReviews,googleMapsUrl:place.locationLink??input,photoUrl:place.photo??undefined,confidence:.95}]
  }
  async getPlace(placeRef:string,language:ProviderLanguage='en'){
    const found=await this.resolvePlace(placeRef,language)
    if(!found[0])throw new Error('PLACE_NOT_FOUND')
    return found[0]
  }
  async fetchReviews(placeRef:string,options:{sort:'newest'|'lowest_rating';limit?:number;since?:string;language?:ProviderLanguage}){
    const result=await fetchApifyReviews(this.token,{placeUrl:placeRef,language:GOOGLE_REVIEWS_IMPORT_LANGUAGE,sort:options.sort,limit:options.limit,since:options.since})
    return{reviews:result.reviews.map(review=>({externalReviewId:review.externalReviewId,authorName:review.authorName,authorAvatarUrl:review.authorImage??undefined,rating:review.rating,text:review.text,translatedText:review.translatedText??undefined,language:review.language??undefined,translatedLanguage:review.translatedLanguage??undefined,publishedAt:review.publishedAt??new Date(0).toISOString(),sourceUrl:review.reviewUrl??result.establishment.locationLink??'https://maps.google.com',ownerResponse:review.ownerResponse??undefined}))}
  }
}

export class SerpApiReviewProvider implements ReviewProvider{
  readonly name='serpapi' as const;constructor(private key:string){}
  async resolvePlace(input:string){const url=new URL('https://serpapi.com/search.json');url.searchParams.set('engine','google_maps');url.searchParams.set('type','search');url.searchParams.set('q',input);url.searchParams.set('hl','fr');url.searchParams.set('api_key',this.key);const data=await withRetry(()=>fetchJson(url.toString()));return((data.local_results??[]) as Record<string,unknown>[]).slice(0,5).map((r,i)=>({placeRef:String(r.place_id??r.data_id),name:String(r.title),address:String(r.address??''),rating:Number(r.rating??0),reviewCount:Number(r.reviews??0),googleMapsUrl:String(r.place_id_search??r.link??`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(input)}`),photoUrl:r.thumbnail?String(r.thumbnail):undefined,confidence:i===0?.88:.68}))}
  async getPlace(placeRef:string){const found=await this.resolvePlace(placeRef);if(!found[0])throw new Error('PLACE_NOT_FOUND');return found[0]}
  async fetchReviews(placeRef:string,{limit,cursor}:{limit:number;cursor?:string}){const url=new URL('https://serpapi.com/search.json');url.searchParams.set('engine','google_maps_reviews');url.searchParams.set('place_id',placeRef);url.searchParams.set('sort_by','newestFirst');url.searchParams.set('num',String(Math.min(limit,20)));url.searchParams.set('hl','fr');url.searchParams.set('api_key',this.key);if(cursor)url.searchParams.set('next_page_token',cursor);const data=await withRetry(()=>fetchJson(url.toString()));return{reviews:((data.reviews??[]) as Record<string,unknown>[]).map((r)=>{const user=(r.user??{}) as Record<string,unknown>;const extracted=(r.extracted_snippet??{}) as Record<string,unknown>;return{externalReviewId:String(r.review_id),authorName:String(user.name??'Client Google'),authorAvatarUrl:user.thumbnail?String(user.thumbnail):undefined,rating:Number(r.rating??0),text:String(r.snippet??extracted.original??''),publishedAt:String(r.iso_date??r.date??new Date().toISOString()),sourceUrl:String(r.link??'https://maps.google.com')}}),nextCursor:data.serpapi_pagination?.next_page_token}}
}

const failures=new Map<string,{count:number;blockedUntil:number}>()
export class ResilientReviewProvider implements ReviewProvider{
  readonly name;constructor(private primary:ReviewProvider,private fallback?:ReviewProvider){this.name=primary.name}
  private async run<T>(method:(provider:ReviewProvider)=>Promise<T>){const state=failures.get(this.primary.name);const canPrimary=!state||state.blockedUntil<Date.now();if(canPrimary){try{const value=await method(this.primary);failures.delete(this.primary.name);console.info(JSON.stringify({event:'review_provider_success',provider:this.primary.name}));return value}catch(error){const count=(state?.count??0)+1;failures.set(this.primary.name,{count,blockedUntil:count>=3?Date.now()+60000:0});console.warn(JSON.stringify({event:'review_provider_failure',provider:this.primary.name,code:error instanceof Error?error.message:'UNKNOWN'}))}}if(this.fallback){console.info(JSON.stringify({event:'review_provider_fallback',provider:this.fallback.name}));return method(this.fallback)}throw new Error('ALL_PROVIDERS_UNAVAILABLE')}
  resolvePlace(input:string){return this.run(p=>p.resolvePlace(input))}getPlace(ref:string){return this.run(p=>p.getPlace(ref))}fetchReviews(ref:string,options:{sort:'newest';limit:number;since?:string;cursor?:string}){return this.run(p=>p.fetchReviews(ref,options))}
}
export function createReviewProvider(){const choice=(Deno.env.get('REVIEW_PROVIDER')??'mock').trim().toLowerCase();if(choice==='mock')return new MockReviewProvider();if(choice==='apify'){const token=Deno.env.get('APIFY_API_TOKEN')?.trim();if(!token)throw new Error('APIFY_TOKEN_MISSING');return new ApifyReviewProvider(token)}if(choice==='outscraper'){const key=Deno.env.get('OUTSCRAPER_API_KEY')?.trim();if(!key)throw new Error('OUTSCRAPER_KEY_MISSING');return new OutscraperReviewProvider(key)}throw new Error('REVIEW_PROVIDER_UNSUPPORTED')}
