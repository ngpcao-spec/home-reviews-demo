// Usage: deno run --cached-only --allow-read scripts/profile-jls-prepared.ts <frozen-compiled-json> <phase>
// NO --allow-net; provider access is forbidden. Source file stays outside Git.
import process from "node:process";
import {preparedCpuExercise} from "../supabase/functions/_shared/jls-restaurant-cpu-probe.ts";
const c=JSON.parse(await Deno.readTextFile(Deno.args[0]));
globalThis.fetch=()=>{throw Error("PROVIDER_NETWORK_FORBIDDEN");};
const before=process.cpuUsage(),at=performance.now();
const result=await preparedCpuExercise(c.protocol.body,c.protocol.sha256,c.artifact,Deno.args[1]??"verify");
const cpu=process.cpuUsage(before),cpu_ms=(cpu.user+cpu.system)/1000;
console.log(JSON.stringify({runtime:Deno.version,cpu_ms,wall_ms:performance.now()-at,cpu_margin_ms:2000-cpu_ms,...result,provider_calls:0}));
