// Offline-only replay. No provider, authorization, run creation or wake.
import { buildPrioritizedRevalidation } from "../supabase/functions/_shared/jls-prioritized-revalidation.ts";
import { negativeHash } from "../supabase/functions/_shared/negative-validation-core.ts";
const [inputPath,outputPath,commit]=Deno.args;
if(!inputPath||!outputPath||!commit)throw Error("REPLAY_INPUT_REQUIRED");
globalThis.fetch=()=>{throw Error("PROVIDER_NETWORK_BLOCKED");};
const input=JSON.parse(await Deno.readTextFile(inputPath));
const paths=["supabase/functions/_shared/jls-fee-disclosure.ts","supabase/functions/_shared/jev-luna-sol-prioritized-validation.ts","supabase/functions/_shared/jls-prioritized-revalidation.ts"];
const files=Object.fromEntries(await Promise.all(paths.map(async path=>[path,await negativeHash(await Deno.readTextFile(path))])));
const original=input.result;
const result=await buildPrioritizedRevalidation(original.run_id,original,input.plan,input.snapshot,input.decisions,{commit,files});
await Deno.writeTextFile(outputPath,JSON.stringify(result));
console.log(JSON.stringify({sha256:result.sha256,validation_sha256:result.body.validation_sha256,controls:result.body.controls,
 recommendations:result.body.validation.report.recommendations.map(x=>({title:x.title,visible:x.visible,reasons:x.reasons}))}));
