// Offline only. No environment credentials, fetch or paid authorization.
import {prepareSnapshotV2} from "../supabase/functions/_shared/jls-snapshot-v2.ts";
import {localHybridTokens} from "../supabase/functions/_shared/jev-hybrid-evidence.ts";
globalThis.fetch=()=>Promise.reject(Error("ALL_PROVIDER_NETWORK_FORBIDDEN"));
const [input,output,code]=Deno.args;if(!input||!output||!code)throw Error("INPUT_OUTPUT_COMMIT_REQUIRED");
const source=JSON.parse(await Deno.readTextFile(input));
const prepared=await prepareSnapshotV2(source.historical,source.cache,code,"jev-1.13.0");
const jev=prepared.body.pending.map(t=>{const request={...t.payload,questions:prepared.body.configuration.jev_request_template.questions};
 return {review_id:t.review_id,bytes:new TextEncoder().encode(JSON.stringify(request)).length,tokens:localHybridTokens(JSON.stringify(request)),request_sha256:t.request_sha256};});
await Deno.writeTextFile(output,JSON.stringify({...prepared,jev_request_measurements:jev},null,2));
console.log(JSON.stringify({sha256:prepared.sha256,source:prepared.body.frozen_v2?.source_fingerprint,stored:100,english:80,textless:20,
 reused:prepared.body.cache.length,pending:prepared.body.pending.length,max_luna:32,max_sol:1,jev_input_tokens:jev.reduce((a,b)=>a+b.tokens,0),
 max_jev_request_bytes:Math.max(...jev.map(r=>r.bytes)),provider_calls:0,paid_consent:null}));
