import {prepareDirectCategories,verifyDirectCategoriesProtocol} from '../supabase/functions/_shared/jev-direct-categories-preparation.ts';
globalThis.fetch=()=>{throw Error('ALL_PROVIDER_NETWORK_FORBIDDEN');};
const [input,output,commit]=Deno.args;
const p=await prepareDirectCategories(JSON.parse(await Deno.readTextFile(input)),commit);await verifyDirectCategoriesProtocol(p);
await Deno.writeTextFile(output,JSON.stringify(p));
console.log(JSON.stringify({sha256:p.sha256,configuration_id:p.body.configuration.id,configuration_sha256:p.body.configuration_sha256,
 reviews:p.body.reviews.length,categories:p.body.category_keys.length,maximum_calls:p.body.policy.max_jev_calls,
 questions:p.body.policy.max_questions,provider_calls:0,consent:null,run:null}));
