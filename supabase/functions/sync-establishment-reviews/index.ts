import {organizationForEstablishment,requireUser} from '../_shared/auth.ts'
import {json,preflight} from '../_shared/cors.ts'
import {syncEstablishment} from '../_shared/sync-service.ts'

Deno.serve(async(request)=>{const pre=preflight(request);if(pre)return pre;try{const {client,admin}=await requireUser(request);const {establishmentId}=await request.json();const establishment=await organizationForEstablishment(client,establishmentId);if(establishment.last_synced_at&&Date.now()-new Date(establishment.last_synced_at).getTime()<300000)return json({error:'MANUAL_SYNC_RATE_LIMIT',retryAfterSeconds:Math.ceil((300000-(Date.now()-new Date(establishment.last_synced_at).getTime()))/1000)},429);return json(await syncEstablishment(admin,establishment,false))}catch(error){const code=error instanceof Error?error.message:'UNKNOWN';return json({error:code},code==='UNAUTHORIZED'?401:code==='ESTABLISHMENT_NOT_FOUND'?404:500)}})
