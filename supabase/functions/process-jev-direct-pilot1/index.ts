// Separate experimental endpoint; no automatic scheduler, scan, fallback or other provider.
// deno-lint-ignore no-import-prefix
import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {directPilotHandler,processDirectPilot1} from '../_shared/jev-direct-pilot1.ts';
import {directPilotPort} from '../_shared/jev-direct-pilot1-store.ts';
declare const EdgeRuntime:{waitUntil(p:Promise<unknown>):void};
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(directPilotHandler({
 authenticate:async r=>{const a=await admin.rpc('verify_review_scheduler_token',{p_token:r.headers.get('x-home-reviews-scheduler')??''});return !a.error&&a.data===true;},
 run:async id=>await processDirectPilot1(directPilotPort(admin),id,Deno.env.get('TYPESAFE_API_KEY')??'',fetch),
 waitUntil:p=>EdgeRuntime.waitUntil(p),
}));
