import {recommendationSheet} from '../../fixtures/restaurant-recommendation-catalogue';
import {recommendRestaurants,recommendationCuisineOptions,type Request} from '../../../supabase/functions/_shared/restaurant-recommendation-engine-v1';
export function recommendationResponse(body:Record<string,unknown>){
 const language=localStorage.getItem('review-details-language')==='fr'?'fr':'vi',org='org-account-a';
 const rows=[recommendationSheet('place-account-a',{score:'5.3',cuisines:['indian'],reservation:language==='fr'?'Un témoignage évoque une attente prolongée.':'Một khách cho biết đã chờ lâu.'}),
  recommendationSheet('place-account-b',{score:'5.25',cuisines:['italian'],category:'service',positive:language==='fr'?'Le personnel est décrit comme accueillant.':'Nhân viên được nhận xét thân thiện.'}),
  recommendationSheet('place-account-c',{score:'5.25',cuisines:['vietnamese']})];
 for(const [i,r]of rows.entries()){
  r.language=language;r.organization_id=org;Object.assign(r.metadata.identity as object,{organization_id:org,name:`Restaurant témoin ${i+1}`});
  Object.assign(r.publication!,{organization_id:org,language});
  if(i!==1){const positive={category:'quality',text:language==='fr'?'Les plats sont appréciés dans les témoignages.':'Các món ăn được khách khen.',evidence_ids:['a'.repeat(64)]};r.report_sections.positive_aspects=[positive];(r.publication!.derived.report as Record<string,unknown>).positive_aspects=[positive];}
  if(i<2)r.metadata.budget={establishment_price:{source:'google_maps_import',status:'provided',observed_at:'2026-10-28',price:'100-200 N ₫'+(i===0?'/người':'')}};
 }
 rows[0].stale=true;rows[0].stale_reason='CORPUS_CHANGED';rows[0].publication!.stale=true;rows[0].publication!.stale_reason='CORPUS_CHANGED';
 const catalogue=localStorage.getItem('recommendation-case')==='limited'?rows.slice(0,1):rows;
 const common={api_version:'recommendation-test-v1',language,organization_id:org,organizations:[{id:org,name:'Organisation témoin'}],cuisines:recommendationCuisineOptions(catalogue,org,language)};
 const request:Request={geography:'not_requested',...(body.cuisine?{cuisines:[String(body.cuisine)]}:{}),...(body.maximum_vnd!==undefined?{budget:{kind:'amount',currency:'VND',unit:'per_person',maximum:Number(body.maximum_vnd)}}:{}),...(body.service_priority?{preferences:{categories:['service']}}:{})};
 return body.action==='options'?common:{...common,result:recommendRestaurants(catalogue,org,language,request)};
}
