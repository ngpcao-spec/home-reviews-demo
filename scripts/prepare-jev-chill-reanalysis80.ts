import {prepareChill80,verifyChill80,type Chill80Input} from '../supabase/functions/_shared/jev-chill-reanalysis80.ts';
globalThis.fetch=()=>{throw Error('PROVIDER_NETWORK_FORBIDDEN');};
const [input,output]=Deno.args;
const p=await prepareChill80(JSON.parse(await Deno.readTextFile(input)) as Chill80Input);await verifyChill80(p);
await Deno.writeTextFile(output,JSON.stringify(p));
console.log(JSON.stringify({sha256:p.sha256,reusable:p.body.reused.length,pending:p.body.pending.length,max_jev_calls:p.body.policy.max_jev_calls,
 configuration_sha256:p.body.configuration_sha256,threshold_sha256:p.body.threshold_sha256,required_served_model:p.body.required_served_model,
 supplier_calls:0,spending_authorization:null,run_id:null}));
