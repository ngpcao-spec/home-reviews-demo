// Free offline replay. No consent, run, job, scheduler or provider access.
import {buildRecommendationReview,type ReviewInput} from "../supabase/functions/_shared/jls-recommendation-review-v2.ts";
import {negativeHash} from "../supabase/functions/_shared/negative-validation-core.ts";
const [inputPath,outputPath,commit]=Deno.args;if(!inputPath||!outputPath||!commit)throw Error("REVIEW_INPUT_REQUIRED");
globalThis.fetch=()=>{throw Error("PROVIDER_NETWORK_BLOCKED");};
const input:ReviewInput=JSON.parse(await Deno.readTextFile(inputPath));
const paths=["supabase/functions/_shared/jls-recommendation-contract-v2.ts","supabase/functions/_shared/jls-order-evidence-v2.ts",
 "supabase/functions/_shared/jls-recommendation-review-v2.ts","supabase/functions/_shared/jev-luna-sol-prioritized-validation.ts",
 "supabase/functions/_shared/jls-editorial-validation.ts"];
const files=Object.fromEntries(await Promise.all(paths.map(async p=>[p,await negativeHash(await Deno.readTextFile(p))])));
const result=await buildRecommendationReview(input,{commit,files});
await Deno.writeTextFile(outputPath,JSON.stringify(result));
console.log(JSON.stringify({sha256:result.sha256,original:result.body.original_revalidation.validation.report.recommendations.map(a=>({visible:a.visible,reasons:a.reasons})),
 derivative:result.body.derivative.validation.report.recommendations.map(a=>({visible:a.visible,reasons:a.reasons})),
 candidate_quotes:result.body.order_candidates.map(e=>({quote:e.quote,id:e.evidence_id,status:e.status})),
 compatible_accepted_order:result.body.compatible_accepted_order_evidence_ids,configuration:result.body.future_preparation.config.version,
 prompt_sha256:result.body.future_preparation.prompt_sha256,schema_sha256:result.body.future_preparation.schema_sha256,request_sha256:result.body.future_preparation.request_sha256,
 measurement:result.body.future_preparation.measurement,new_paid_calls:0}));

