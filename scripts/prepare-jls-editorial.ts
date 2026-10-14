// Free offline artifact only. No network permissions, provider or spending RPC.
import {buildEditorialDraft} from "../supabase/functions/_shared/jls-prioritized-editorial.ts";
import {verifyJlsPlan} from "../supabase/functions/_shared/jev-luna-sol.ts";
import {hybridHash} from "../supabase/functions/_shared/jev-hybrid-evidence.ts";
const [inputPath,outputPath]=Deno.args;if(!inputPath||!outputPath)throw Error("JLS_EDITORIAL_INPUT_REQUIRED");
globalThis.fetch=()=>{throw Error("PROVIDER_NETWORK_BLOCKED");};
const input=JSON.parse(await Deno.readTextFile(inputPath));
await verifyJlsPlan(input.p,input.source,input.snapshot);
const artifacts=[];
for(const language of ["fr","vi"] as const){
 const draft=await buildEditorialDraft(input.p,input.decisions,language);
 const body={version:draft.version,language,organization_id:input.p.organization_id,source_plan_id:input.source_plan_id,
  source_plan_sha256:await hybridHash(input.p),source_run_id:input.source_run_id,source_result_sha256:input.source_result_sha256,
  execution_authorized:false,draft};
 const artifact={body,sha256:await hybridHash(body)};artifacts.push(artifact);
 console.log(JSON.stringify({language,sha256:artifact.sha256,accepted:draft.accepted_ids.length,coverage_gaps:draft.coverage.filter(x=>x.coverage_status==="missing_accepted_evidence").map(x=>x.theme_key),estimates:draft.estimates,request_sha256:draft.request_sha256,prompt_sha256:draft.prompt_sha256,config_sha256:draft.config_sha256,schema_sha256:draft.schema_sha256}));
}
await Deno.writeTextFile(outputPath,JSON.stringify(artifacts));
