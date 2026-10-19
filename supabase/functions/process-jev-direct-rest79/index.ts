// Isolated experimental continuation; existing production and one-review pilot handlers stay unchanged.
// deno-lint-ignore no-import-prefix
import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {processRest79} from '../_shared/jev-direct-rest79.ts';
import {rest79Port} from '../_shared/jev-direct-rest79-store.ts';
declare const EdgeRuntime:{waitUntil(p:Promise<unknown>):void};
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(async r=>{
 const json=(b:unknown,status:number)=>new Response(JSON.stringify(b),{status,headers:{'Content-Type':'application/json'}});
 if(r.method!=='POST')return json({error:'METHOD_NOT_ALLOWED',provider_calls:0},405);
 const a=await admin.rpc('verify_review_scheduler_token',{p_token:r.headers.get('x-home-reviews-scheduler')??''});
 if(a.error||a.data!==true)return json({error:'UNAUTHORIZED',provider_calls:0},401);
 const b=await r.json().catch(()=>null);
 if(!b||Object.keys(b).join()!=='execution_id'||typeof b.execution_id!=='string'||!/^[a-f0-9-]{36}$/.test(b.execution_id))return json({error:'INVALID_SCOPE'},400);
 EdgeRuntime.waitUntil(processRest79(rest79Port(admin),b.execution_id,Deno.env.get('TYPESAFE_API_KEY')??'',fetch).catch(()=>console.error('REST79_STOPPED_NO_RETRY')));
 return json({accepted_background:true,max_new_jev_calls:79,automatic_retry:false},202);
});
