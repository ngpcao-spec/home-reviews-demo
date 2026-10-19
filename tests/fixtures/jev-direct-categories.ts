// Synthetic contract cases, never supplier predictions or AI reference annotations.
import {DIRECT_CATEGORY_KEYS,DIRECT_NATIVE_CHOICES,directHash,type DirectCategory,type DirectNativeChoice} from '../../supabase/functions/_shared/jev-direct-categories.ts';
import {DIRECT_SOURCE_ID,DIRECT_SOURCE_SHA256,type DirectFrozenSource} from '../../supabase/functions/_shared/jev-direct-categories-preparation.ts';
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text.ts';
export const directRuleCases:{name:string;text:string;expected:Partial<Record<DirectCategory,DirectNativeChoice>>}[]=[
 {name:'generic service',text:'Good service.',expected:{service:'positive'}},
 {name:'good drinks slow delivery',text:'The drinks were delicious but took far too long to arrive.',expected:{quality:'positive',service:'negative'}},
 {name:'amount only',text:'The bill was 500000 VND.',expected:{}},
 {name:'explicit neutral',text:'The food was average, neither good nor bad.',expected:{quality:'neutral'}},
 {name:'qualified ambiguous',text:'The food was not extraordinary.',expected:{quality:'uncertain'}},
 {name:'qualified praise',text:'The food was good, although not extraordinary.',expected:{quality:'positive'}},
 {name:'explicit negation',text:'The soup was not good at all.',expected:{quality:'negative'}},
 {name:'mixed service',text:'The staff were friendly but the service was painfully slow.',expected:{service:'mixed'}},
 {name:'mixed food and drinks',text:'The meal was delicious but the coffee was awful.',expected:{quality:'mixed'}},
 {name:'mixed price',text:'The menu prices were fair but the unexpected service charge was poorly announced.',expected:{price:'mixed'}},
 {name:'distance outside ambiance',text:'The atmosphere was pleasant but the drive was long.',expected:{ambiance:'positive'}},
 {name:'geography only',text:'The restaurant is far from the city center.',expected:{}},
 {name:'later resolution',text:'The contradictory reservation messages were frustrating, but staff later handled the clarification helpfully.',expected:{service:'mixed'}},
 {name:'unclear fee',text:'The parking fee information was unclear; I do not know who operates the parking.',expected:{price:'negative'}},
 {name:'ambiguous attachment',text:'I am not sure whether the quality of the meal was good or bad.',expected:{quality:'uncertain'}},
 {name:'mixed ambiance',text:'The room was beautifully decorated but uncomfortably noisy.',expected:{ambiance:'mixed'}},
 {name:'vessel not food quantity',text:'The rim of the pot was too narrow to scoop broth.',expected:{}},
 {name:'self selected order size',text:'We ordered three dishes for two people and ordered too much.',expected:{}},
 {name:'menu availability',text:'The menu lacked the vegetarian options we wanted, which was disappointing.',expected:{quality:'negative'}},
 {name:'temperature',text:'The soup was served unpleasantly cold.',expected:{quality:'negative'}},
 {name:'portion and taste',text:'The food was delicious but the portion was far too small.',expected:{quality:'mixed'}},
 {name:'premises cleanliness',text:'The dining room was dirty.',expected:{ambiance:'negative'}},
 {name:'neutral plus favorable',text:'The soup was neither good nor bad, but the dessert was delicious.',expected:{quality:'positive'}},
];
export function directMockRaw(labels:Partial<Record<DirectCategory,DirectNativeChoice>>={}){
 return {model:'jev-explicit-technical-mock',usage:{input_tokens:10,output_tokens:0},answers:Object.fromEntries(DIRECT_CATEGORY_KEYS.map(k=>{
  const choice=labels[k]??'not_mentioned';return [k,{type:'choice',choice,confidence:1,
   probabilities:Object.fromEntries(DIRECT_NATIVE_CHOICES.map(c=>[c,c===choice?1:0]))}];
 }))} as {model:string;usage?:{input_tokens:number;output_tokens:number};answers:Record<string,{type:string;choice?:string;confidence?:number;probabilities?:Record<string,number>|null}>};
}
export async function directSyntheticSource():Promise<DirectFrozenSource>{
 const organization_id='00000000-0000-4000-8000-000000000001',establishment_id='a9a6ec1c-cbb3-4e39-a498-86f2e68bd4b8',reviews=[];
 for(let i=1;i<=100;i++){const text=i<=80?'Explicit synthetic English review '+i+'.':'';
  reviews.push({id:'00000000-0000-4000-8000-'+String(i+100).padStart(12,'0'),organization_id,establishment_id,rating:i%5+1,
   original_text:text,original_text_sha256:await analysisTextSha256(text),analysis_text:text||null,
   analysis_text_sha256:text?await analysisTextSha256(text):null,analysis_language:text?'en':null,analysis_source:text?'original_en':'textless',
   translation_provenance:{source:'EXPLICIT_SYNTHETIC_MOCK'}});
 }
 return {id:DIRECT_SOURCE_ID,table:'public.analysis_jls_snapshot_preparations',record_sha256:DIRECT_SOURCE_SHA256,
  record_hash_verified:true,reviews_sha256:await directHash(reviews),organization_id,parent_protocol_id:'EXPLICIT_MOCK_NOT_AN_ARCHIVE',establishment_id,
  authority_user_id:'00000000-0000-4000-8000-000000000002',historical_report_id:'39556285-21ee-4962-9892-da3b4f0e8ca3',
  snapshot_sha256:'0'.repeat(64),reviews};
}
