import {supabase} from './supabase';
import type {Result,Proposal} from '../../supabase/functions/_shared/restaurant-recommendation-engine-v1';
export type {Proposal};
export type RecommendationTestInput={action:'options'|'recommend';organization_id?:string;cuisine?:string;maximum_vnd?:number;service_priority?:boolean};
export type RecommendationTestResponse={api_version:string;language:'fr'|'vi';organization_id:string;organizations:{id:string;name:string}[];cuisines:string[];result?:Result};
export async function recommendationTestApi(body:RecommendationTestInput):Promise<RecommendationTestResponse>{
 if(!supabase)throw Error('UNAUTHORIZED');
 const {data,error}=await supabase.functions.invoke('test-restaurant-recommendations',{body});
 if(error){
  let code='RECOMMENDATION_TEST_UNAVAILABLE';
  if(error.context instanceof Response){
   if(error.context.status===401)code='UNAUTHORIZED';
   else if(error.context.status===403)code='FORBIDDEN';
   else if(error.context.status===400)code='INVALID_RECOMMENDATION_REQUEST';
  }
  throw Error(code);
 }
 if(!data||data.api_version!=='recommendation-test-v1'||!['fr','vi'].includes(data.language))throw Error('RECOMMENDATION_TEST_UNAVAILABLE');
 return data as RecommendationTestResponse;
}
