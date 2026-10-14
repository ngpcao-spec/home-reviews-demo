import {GARDEN,prepareRestaurant} from "../../supabase/functions/_shared/jls-restaurant";
import {ECONOMY_CONFIG} from "../../supabase/functions/_shared/jev-economy-config";
import {hybridHash} from "../../supabase/functions/_shared/jev-hybrid-evidence";
import {resolvePilotReviews,pilotSourceHash,type PilotRawReview,type PilotSnapshot} from "../../supabase/functions/_shared/jev-pilot-core";
import {THEME_KEYS,type ThemeChoice} from "../../supabase/functions/_shared/jev-themes";
import {economyIdentity,economyCacheKey,economicThemeResults,type EconomyCache} from "../../supabase/functions/_shared/jev-economy-cache";
import type {RestaurantState,RestaurantPort} from "../../supabase/functions/_shared/jls-restaurant-worker";
export async function gardenFixture() {
 const org="93228bbb-6397-41e3-b8be-21ee7060eda7",u="d6e79d9c-72cd-40d2-a945-0452b268a783";
 const samples=[["The food was delicious.","food_quality","positive"],["The steak tasted bad.","food_quality","negative"],
  ["We waited a long time for our dishes.","wait_time","negative"],["The server checked on our table.","attentiveness","positive"],
  ["The prices were too expensive.","price_level","negative"],["The meal was worth the money.","value","positive"],
  ["The atmosphere was lovely.","atmosphere","positive"],["The atmosphere was unpleasant.","atmosphere","negative"],
  ["The coffee was excellent.","drinks","positive"],["The room was very noisy.","noise","negative"],
  ["The chair was comfortable.","comfort","positive"],["Our waiter explained the menu clearly.","communication","positive"]];
 const raw=samples.map(([text],i)=>({id:"10000000-0000-4000-8000-"+String(i+1).padStart(12,"0"),organization_id:org,establishment_id:GARDEN,
  rating:i<3?1:i<6?3:5,original_text:text,original_language:"en",review_detailed_rating:null,review_context:null,published_at:null,review_translations:[]} satisfies PilotRawReview));
 const reviews=await resolvePilotReviews(raw,[],org,GARDEN,"2026-10-14T00:00:00Z"),source={google_total_reviews:100,establishment_name:"SYNTHETIC GARDEN TEST",reviews,legacy:null};
 const snapshot:PilotSnapshot={id:crypto.randomUUID(),organization_id:org,establishment_id:GARDEN,name:"SYNTHETIC",created_by:u,created_at:"2026-10-14T00:00:00Z",
  source,source_sha256:await pilotSourceHash(source),config_sha256:await hybridHash(ECONOMY_CONFIG),production_enabled:false,
  rates:{jev_input:null,jev_output:null,sol_input:null,sol_output:null,apify_import:null,english_translation:null,observed_jev_input_per_review:null,
   observed_jev_output_per_review:null,observed_sol_input:null,observed_sol_output:null,provenance:[]},preview_at_creation:null};
 const body=await prepareRestaurant(snapshot,[],[],"explicit synthetic test", "jev-1.13.0"),protocol={id:crypto.randomUUID(),body,sha256:await hybridHash(body)};
 const state:RestaurantState={protocol,run:{id:crypto.randomUUID(),stage:"jev",status:"queued"},tasks:body.pending.map(p=>({
  id:crypto.randomUUID(),run_id:"",organization_id:org,phase:"jev",review_id:p.review_id,request:{...p.payload,questions:body.configuration.jev_request_template.questions},request_sha256:p.request_sha256,
  identity:p.identity,status:"pending",request_count:0,worker:"",cache_id:null})),artifacts:[]};
 state.tasks.forEach(t=>t.run_id=state.run.id);
 const cache:(EconomyCache&{theme_results:unknown})[]=[];let go=false,expired=false,leased=false,lastError:string|null=null;const calls:string[]=[];
 const port:RestaurantPort={load:async()=>state,cache:async()=>cache,tick:async(_run,worker)=>{
  if(!go||expired||leased||!["queued","running"].includes(state.run.status))return false;leased=true;state.run.status="running";
  state.tasks.filter(t=>t.status==="pending").forEach(t=>t.worker=worker);return true;
 },claim:async(_run,worker)=>{
  const t=state.tasks.find(t=>t.phase===state.run.stage&&t.status==="pending"&&t.request_count===0);
  if(!t)return null;t.status="running";t.request_count=1;t.worker=worker;return t;
 },artifact:async(_run,_worker,kind,b,sha)=>{
  const old=state.artifacts.find(x=>x.kind===kind);if(old)return old.sha256===sha;
  state.artifacts.push({kind,body:b as Record<string,unknown>,sha256:sha});return true;
 },finish:async(id,_worker,status,b,sha)=>{
  const t=state.tasks.find(t=>t.id===id)!;t.status=status;
  state.artifacts.push({kind:"task:"+id,body:b as Record<string,unknown>,sha256:sha});
  if(status!=="completed")state.run.status=status==="billing_uncertain"?status:"blocked";
  const x=b as {jev_response:EconomyCache["response"];theme_results:unknown};
  if(t.phase==="jev"&&status==="completed"){
   const identity=await economyIdentity(org,GARDEN,t.review_id!,reviews.find(r=>r.id===t.review_id)!.analysis_text!,"jev-1.13.0");
   const c={...identity,id:crypto.randomUUID(),cache_key:await economyCacheKey(identity),status:"completed" as const,response:x.jev_response,
    theme_results:x.theme_results,served_model:"jev-1.13.0",input_tokens:100,output_tokens:0,cost_usd:null,usage_complete:true,
    processed_at:"2026-10-14T00:00:00Z",source_task_id:t.id};
   cache.push(c);
  }return true;
 },stage:async(_run,_worker,phase,ts)=>{
  if(phase==="completed"){state.run.status="completed";return true;}
  state.run.stage=phase as "luna"|"sol";
  for(const x of ts as {review_id?:string;request:unknown;request_sha256:string}[])state.tasks.push({
   id:crypto.randomUUID(),run_id:state.run.id,organization_id:org,phase:state.run.stage,review_id:x.review_id??null,request:x.request,
   request_sha256:x.request_sha256,identity:null,status:"pending",request_count:0,worker:"",cache_id:null});
  return true;
 },release:async(_run,_worker,error)=>{leased=false;lastError=error;if(error)state.run.status="blocked";}};
 const http:typeof fetch=async(url,options)=>{
  if(!leased)throw Error("RESERVATION_MISSING");calls.push(String(url));
  const q=JSON.parse(String(options?.body)),usage={input_tokens:100,output_tokens:0,total_tokens:100};
  if(String(url).includes("systemone")){
   const i=samples.findIndex(s=>s[0]===q.state.analysis_text);
   const themes=Object.fromEntries(THEME_KEYS.map(k=>{
    const choice:ThemeChoice=k===samples[i][1]?samples[i][2] as ThemeChoice:"absent";
    return [k,{type:"choice",choice,probabilities:Object.fromEntries(["absent","positive","negative","both"].map(c=>[c,c===choice?1:0]))}];}));
   return new Response(JSON.stringify({model:"jev-1.13.0",usage,answers:themes}));
  }
  if(String(url).endsWith("/decisions"))return new Response(JSON.stringify({model:"gpt-6-luna",usage,
   answers:q.questions.map((x:{name:string})=>({name:x.name,type:"choice",choice:"supported",probabilities:[{value:"supported",probability:.95},{value:"unsupported",probability:.03},{value:"uncertain",probability:.02}],confidence:.95}))}));
  const p=state.artifacts.find(a=>a.kind==="evidence_plan")!.body as unknown as import("../../supabase/functions/_shared/jev-luna-sol").JlsPlan;
  const axes=["service","quality","price","atmosphere"].map(axis=>({axis,text:"Khách chia sẻ nhận xét về trải nghiệm.",evidence_ids:[p.selected.find(e=>e.axis===axis)!.evidence_id]}));
  const report={format_version:"jls-prioritized-recommendations-v1",statistics_sha256:p.statistics_sha256,
   report:{axes,positive_aspects:[],negative_aspects:[],conclusion:{text:"Cần xem xét các phản ánh trong phạm vi đã phân tích.",evidence_ids:[p.selected[0].evidence_id]},recommendations:[]}};
  return new Response(JSON.stringify({model:"gpt-6.1-sol",usage,status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(report)}]}]}));
 };
 return {state,port,http,calls,getError:()=>lastError,authorize:()=>{go=true;},expire:()=>{expired=true;},cache,
  completedCache:async()=>{for(let i=0;i<reviews.length;i++){
   const identity=await economyIdentity(org,GARDEN,reviews[i].id,reviews[i].analysis_text!,"jev-1.13.0");
   const r=JSON.parse(await (await http("https://api.typesafe.ai/v1/systemone",{body:JSON.stringify({state:{analysis_text:reviews[i].analysis_text}})})).text());
   const decision={themes:Object.fromEntries(THEME_KEYS.map(k=>[k,r.answers[k]]))} as EconomyCache["response"];
   cache.push({...identity,id:crypto.randomUUID(),cache_key:await economyCacheKey(identity),status:"completed",response:decision,
    theme_results:economicThemeResults(decision!),served_model:"jev-1.13.0",input_tokens:100,output_tokens:0,cost_usd:null,usage_complete:true,processed_at:null,source_task_id:null});
  }}};
}
