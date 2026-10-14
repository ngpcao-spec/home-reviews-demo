// Free/offline protocol only. No consent builder, network, secret or execution RPC.
import { prioritizedExecutionProtocol } from "../supabase/functions/_shared/jls-prioritized-execution.ts";
import { hybridHash } from "../supabase/functions/_shared/jev-hybrid-evidence.ts";
const [inputPath,outputPath]=Deno.args;if(!inputPath||!outputPath)throw Error("JLS_PRI_INPUT_REQUIRED");
const input=JSON.parse(await Deno.readTextFile(inputPath));
const body=await prioritizedExecutionProtocol(input.preparation,input.p,input.history),sha256=await hybridHash(body);
await Deno.writeTextFile(outputPath,JSON.stringify({body,sha256}));
console.log(JSON.stringify({version:body.version,sha256,language:body.language,estimates:body.estimates,
  hashes:Object.fromEntries(Object.entries(body).filter(([k])=>k.endsWith("sha256")))}));
