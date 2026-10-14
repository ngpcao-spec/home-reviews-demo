// deno-lint-ignore no-import-prefix
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
import {json} from "../_shared/cors.ts";
import {restaurantPort} from "../_shared/jls-restaurant-store.ts";
import {processRestaurant} from "../_shared/jls-restaurant-worker.ts";
declare const EdgeRuntime:{waitUntil(p:Promise<unknown>):void};
Deno.serve(async r=>{
 if(r.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
 const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
 const auth=await admin.rpc("verify_review_scheduler_token",{p_token:r.headers.get("x-home-reviews-scheduler")??""});
 if(auth.error||auth.data!==true)return json({error:"UNAUTHORIZED"},401);
 const {data:runs,error}=await admin.from("analysis_jls_restaurant_runs").select("id").in("status",["queued","running"]);
 if(error)return json({error:"JLS_DATABASE_FAILED"},409);
 if(!runs?.length)return json({claimed:0,new_paid_calls:0});
 const work=(async()=>{for(const run of runs)try{
  await processRestaurant(restaurantPort(admin),run.id,{jev:Deno.env.get("TYPESAFE_API_KEY")??"",openai:Deno.env.get("OPENAI_API_KEY")??""},fetch);
 }catch{/* Claimed attempts are never reset or retried. */}})();
 EdgeRuntime.waitUntil(work);return json({accepted_background:true},202);
});
