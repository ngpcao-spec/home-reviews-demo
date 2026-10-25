import {requireUser} from '../_shared/auth.ts'
import {json,preflight} from '../_shared/cors.ts'
Deno.serve(async request=>{const p=preflight(request);if(p)return p;try{await requireUser(request);return json({error:'ENGLISH_BACKFILL_RETIRED',provider_calls:0},410)}catch{return json({error:'UNAUTHORIZED'},401)}})
