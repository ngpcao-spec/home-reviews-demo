import {json,preflight} from '../_shared/cors.ts'
import {requireUser} from '../_shared/auth.ts'
import {enforceRateLimit} from '../_shared/rate-limit.ts'
import {createReviewProvider} from '../_shared/review-provider.ts'

Deno.serve(async(request)=>{const pre=preflight(request);if(pre)return pre;try{const {user}=await requireUser(request);enforceRateLimit(`resolve:${user.id}`,10,60000);const {input}=await request.json();if(typeof input!=='string'||input.trim().length<2||input.length>500)return json({error:'INVALID_INPUT'},400);if(/^https?:\/\//.test(input)){const url=new URL(input);if(!/(^|\.)google\.[a-z.]+$/.test(url.hostname)&&url.hostname!=='maps.app.goo.gl')return json({error:'UNSUPPORTED_URL'},400)}const candidates=await createReviewProvider().resolvePlace(input.trim());return json({candidates})}catch(error){const code=error instanceof Error?error.message:'UNKNOWN';return json({error:code},code==='UNAUTHORIZED'?401:code==='RATE_LIMITED'?429:500)}})
