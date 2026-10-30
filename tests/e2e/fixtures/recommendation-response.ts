import {recommendationSheet} from '../../fixtures/restaurant-recommendation-catalogue';
import {recommendRestaurants,recommendationCuisineOptions,type Request} from '../../../supabase/functions/_shared/restaurant-recommendation-engine-v1';
import {prepareAi,renderChoices,validateChoices} from '../../../supabase/functions/_shared/recommendation-ai';
import {placeProfile} from '../../../supabase/functions/_shared/google-place-profile';
export function recommendationResponse(body:Record<string,unknown>){
 if(body.action==='compare'&&body.preference_mode!=='report_facts_v3')throw Error('Updated comparison client required');
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
 const sourceCase=localStorage.getItem('recommendation-ai-case')==='sources';
 if(sourceCase){
  const positives=[{category:'quality',text:language==='fr'?'Les plats sont appréciés dans les témoignages. Le poulet est décrit comme tendre ; la sauce est relevée et équilibrée. Une boisson à la mangue et un dessert au chocolat sont cités.':'Các món ăn được khách khen. Thịt gà được nhận xét mềm, nước sốt đậm vị và cân bằng. Đồ uống xoài và món tráng miệng sô-cô-la được nhắc cụ thể.',evidence_ids:['a'.repeat(64)]}];
  rows[0].report_sections.positive_aspects=positives;(rows[0].publication!.derived.report as Record<string,unknown>).positive_aspects=positives;
  const reservations=[{category:'service',text:language==='fr'?'Une attente est signalée.':'Có phản ánh về thời gian chờ.',evidence_ids:['b'.repeat(64)]},
   {category:'ambiance',text:language==='fr'?'Un client souhaiterait davantage d’espace, tout en appréciant le cadre.':'Một khách mong có thêm không gian, dù vẫn khen khung cảnh.',evidence_ids:['c'.repeat(64)]}];
  rows[0].report_sections.reservations=reservations;(rows[0].publication!.derived.report as Record<string,unknown>).negative_aspects=reservations;
  rows[0].metadata.google_place_profile={...placeProfile([{cid:'123',language,scrapedAt:'2026-10-28T01:02:03Z',reviews:[],additionalInfo:{'Bầu không khí':[{'Yên tĩnh':true}]}}],{google_id:'123',place_id:null,google_maps_url:'https://www.google.com/maps?cid=123',language}),binding:{establishment_id:rows[0].establishment_id,organization_id:org}};
 }
 const catalogue=localStorage.getItem('recommendation-case')==='limited'?rows.slice(0,1):rows;
 const common={api_version:'recommendation-test-v1',language,organization_id:org,organizations:[{id:org,name:'Organisation témoin'}],cuisines:recommendationCuisineOptions(catalogue,org,language)};
 const request:Request={geography:'not_requested',...(body.cuisine?{cuisines:[String(body.cuisine)]}:{}),...(body.maximum_vnd!==undefined?{budget:{kind:'amount',currency:'VND',unit:'per_person',maximum:Number(body.maximum_vnd)}}:{}),...(body.service_priority?{preferences:{categories:['service']}}:{})};
 const result=recommendRestaurants(catalogue,org,language,request);
 const aiCase=localStorage.getItem('recommendation-ai-case'),prepared=prepareAi({rows:catalogue,organizationId:org,language,establishments:[]},request,String(body.preference??''));
 const choices=result.proposals.slice(0,2).reverse().map(p=>({id:p.establishment_id,reason_refs:sourceCase&&p.establishment_id===rows[0].establishment_id?['feature_quiet','strength_quality_0']:['score_global'],caution_ref:sourceCase&&p.establishment_id===rows[0].establishment_id?'reservation_ambiance_1':p.reservations.length?'reservation_'+p.reservations[0].category+'_'+p.reservations[0].index:null}));
 const comparison=body.action==='compare'?{status:aiCase==='invalid'?'fallback':aiCase==='cached'?'cached':aiCase==='pending'?'pending':'completed',model:'gpt-6.1-sol',attempt_id:'00000000-0000-4000-8000-000000000001',candidate_count:catalogue.length,selections:aiCase==='invalid'||aiCase==='pending'?[]:renderChoices(validateChoices({choices},prepared),prepared),metrics:{input_tokens:123,output_tokens:25,cache_read_tokens:0,cache_write_tokens:null,duration_ms:500,cost_usd:null,cost_kind:'unavailable',model:'gpt-6.1-sol',provider_request_id:'fixture'}}:undefined;
 return body.action==='options'?common:{...common,result,...(comparison?{comparison}:{})};
}
