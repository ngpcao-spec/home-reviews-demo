import {rehearseSnapshotV2} from "../supabase/functions/_shared/jls-snapshot-v2-probe.ts";
globalThis.fetch=()=>Promise.reject(Error("ALL_PROVIDER_NETWORK_FORBIDDEN"));
const [input,output]=Deno.args;if(!input||!output)throw Error("INPUT_OUTPUT_REQUIRED");
const p=JSON.parse(await Deno.readTextFile(input)),start=performance.now();
const result=await rehearseSnapshotV2({id:p.id??"EXPLICIT_MOCK_PROTOCOL",body:p.body,sha256:p.sha256});
await Deno.writeTextFile(output,JSON.stringify(result));console.log(JSON.stringify({...result.measurements,wall_ms:performance.now()-start,provider_calls:0}));
