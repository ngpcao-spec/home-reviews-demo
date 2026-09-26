import {requireUser} from '../_shared/auth.ts'
import {json,preflight} from '../_shared/cors.ts'

Deno.serve(async(request)=>{const pre=preflight(request);if(pre)return pre;try{const {user,client}=await requireUser(request);const {endpoint,keys}=await request.json();if(typeof endpoint!=='string'||!endpoint.startsWith('https://')||typeof keys?.p256dh!=='string'||typeof keys?.auth!=='string')return json({error:'INVALID_SUBSCRIPTION'},400);const {error}=await client.from('push_subscriptions').upsert({user_id:user.id,endpoint,p256dh:keys.p256dh,auth:keys.auth,user_agent:request.headers.get('user-agent')},{onConflict:'endpoint'});if(error)throw error;return json({ok:true})}catch(error){return json({error:error instanceof Error?error.message:'UNKNOWN'},401)}})
