import {createClient} from 'npm:@supabase/supabase-js@2.117.2'
import {json} from '../_shared/cors.ts'
Deno.serve(async request=>{
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}})
 const r=await admin.rpc('verify_review_scheduler_token',{p_token:request.headers.get('x-home-reviews-scheduler')??''})
 if(r.error||r.data!==true)return json({error:'UNAUTHORIZED'},401)
 return json({disabled:true,reason:'GOOGLE_TRANSLATIONS_ONLY',processed:0})
})
