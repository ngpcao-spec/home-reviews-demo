// Explicit synthetic data; no actual report, consent or provider.
import {prioritizedFixture} from "../tests/fixtures/jev-luna-sol-prioritized.ts";
import {buildEditorialDraft} from "../supabase/functions/_shared/jls-prioritized-editorial.ts";
globalThis.fetch=()=>{throw Error("PROVIDER_NETWORK_BLOCKED");};
const views:Record<string,unknown>={};
for(const language of ["fr","vi"] as const){const f=await prioritizedFixture(language);views[language]=await buildEditorialDraft(f.p,f.decisions,language);}
await Deno.writeTextFile("tests/e2e/fixtures/jls-editorial.json",JSON.stringify({simulated_test_fixture:true,views}));
