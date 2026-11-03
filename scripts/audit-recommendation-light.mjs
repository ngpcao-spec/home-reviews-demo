// Offline only. Private source paths are explicit CLI arguments, never committed data.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {getEncoding} from 'js-tiktoken';
const [cataloguePath,receiptPath,destination]=process.argv.slice(2);
if(!cataloguePath||!receiptPath||!destination)throw Error('Usage: node scripts/audit-recommendation-light.mjs catalogue.json receipt.json private-output-directory');
const catalogue=JSON.parse(fs.readFileSync(cataloguePath,'utf8')).catalogue;
const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8')),ids=receipt.trace.candidate_ids;
assert.equal(ids.length,20);assert.equal(new Set(ids).size,20);
const oldDirect=execFileSync('git',['show','d996844b7c850031f86fca667b97546284a8900b:supabase/functions/_shared/recommendation-direct-choice.ts'],{encoding:'utf8'});
const oldPrompt=oldDirect.match(/export const directChoicePrompt=`([\s\S]*?)`;/)[1];
const vite=await createServer({server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true}});
const original=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('NETWORK_FORBIDDEN');};
try{
 const ai=await vite.ssrLoadModule('/supabase/functions/_shared/recommendation-ai.ts');
 const encoder=getEncoding('o200k_base'),tokens=v=>encoder.encode(typeof v==='string'?v:JSON.stringify(v)).length;
 // Exact historical request text/controls were intentionally not persisted.
 // Compare the exact recorded candidate IDs and order with a shared EMPTY request,
 // not a reconstruction of that missing private text. No provider token endpoint.
 const prepared=ai.prepareDirectAi(catalogue,{geography:'not_requested'},'');
 const lightInput=JSON.parse(prepared.request.input),full=ai.prepareAi(catalogue,{geography:'not_requested'},'');
 const reorder=candidates=>ids.map(id=>{const c=candidates.find(c=>c.id===id);assert.ok(c,`Missing recorded candidate ${id}`);return c;});
 lightInput.candidates=reorder(lightInput.candidates);
 const oldCandidates=reorder(full.candidates).map(({criterion_observations:_,...c})=>c);
 const oldInput={configuration_version:'recommendation-ai-direct-choice-v10',content_version:'recommendation-report-points-v1',contract_version:'recommendation-direct-choice-v1',language:catalogue.language,mandatory_constraints:{geography:'not_requested'},natural_language_request:'',candidates:oldCandidates};
 const oldRequest={...prepared.request,instructions:oldPrompt,input:JSON.stringify(oldInput)};
 const lightRequest={...prepared.request,input:JSON.stringify(lightInput)};
 const count=request=>({utf8_bytes:Buffer.byteLength(JSON.stringify(request)),candidate_tokens:tokens(JSON.parse(request.input).candidates),input_text_tokens:tokens(request.input),instructions_tokens:tokens(request.instructions),schema_tokens:tokens(request.text.format.schema),local_text_plus_schema_tokens:tokens(request.input)+tokens(request.instructions)+tokens(request.text.format.schema)});
 const before=count(oldRequest),after=count(lightRequest);
 const perCandidate=lightInput.candidates.map(c=>({id:c.id,name:c.name,tokens:tokens(c),reservations:c.reservations.length,summary_points:c.review_summary.length}));
 // Every prior published reservation survives word for word after whitespace
 // normalization/privacy redaction. No model or semantic judgment is involved.
 const normalize=s=>s.replace(/\s+/gu,' ').trim();
 for(const c of oldCandidates){const light=lightInput.candidates.find(l=>l.id===c.id);for(const f of c.facts.filter(f=>f.kind==='reservation'))assert.ok(light.reservations.some(r=>r.text===normalize(f.value.text)),`Lost reservation ${c.id}/${f.ref}`);}
 const delta=before.local_text_plus_schema_tokens-after.local_text_plus_schema_tokens;
 const calibrated=receipt.metrics.input_tokens-delta;
 const rates={input_usd_per_million:2,output_usd_per_million:10,cache_read_tokens:0,output_tokens_held_constant:receipt.metrics.output_tokens,cache_write_30m_usd_per_million:2.5,cache_write_12h_usd_per_million:5,source:'https://developers.openai.com/api/docs/pricing',checked_on:'2026-11-02'};
 const cost=n=>({input_usd:n*rates.input_usd_per_million/1e6,total_usd:(n*rates.input_usd_per_million+rates.output_tokens_held_constant*rates.output_usd_per_million)/1e6});
 const writes=receipt.metrics.cache_write_tokens,ratio=writes/receipt.metrics.input_tokens;
 const writeCost=(n,rate)=>(n*(1-ratio)*rates.input_usd_per_million+n*ratio*rate+rates.output_tokens_held_constant*rates.output_usd_per_million)/1e6;
 const report={attempt_id:receipt.id,network_calls:calls,exact_candidate_ids_and_order:true,exact_historical_request_replay:false,reason:'Historical free text and controls are not stored; identical empty request for both local variants. Saved catalogue verified against current and pre-v14 row hashes separately.',language:catalogue.language,tokenizer:'js-tiktoken 1.0.21 / o200k_base; exact local encoding counts, NOT a verified gpt-6.1-sol billing tokenizer',historical_provider_input_tokens:receipt.metrics.input_tokens,before,after,local_token_reduction:delta,local_reduction_percent:100*delta/before.local_text_plus_schema_tokens,provider_calibrated_after_estimate:calibrated,per_candidate:perCandidate,rates,cost_estimates:{historical_at_same_rates:cost(receipt.metrics.input_tokens),new_provider_calibrated:cost(calibrated),local_before:cost(before.local_text_plus_schema_tokens),local_after:cost(after.local_text_plus_schema_tokens),cache_write_scenarios:{historical_write_tokens:writes,retention_duration:'unknown in receipt; scenarios only, no invoice cost returned',same_write_proportion_assumed:true,write_30m:{before_usd:writeCost(receipt.metrics.input_tokens,2.5),after_usd:writeCost(calibrated,2.5)},write_12h:{before_usd:writeCost(receipt.metrics.input_tokens,5),after_usd:writeCost(calibrated,5)}}},all_prior_reservations_preserved:true};
 assert.equal(calls,0);fs.mkdirSync(destination,{recursive:true});
 for(const [name,value]of Object.entries({'comparison.private.json':report,'examples.private.json':lightInput.candidates.filter(c=>receipt.trace.selected_candidate_ids.includes(c.id)),'input-before.private.json':oldRequest,'input-after.private.json':lightRequest}))fs.writeFileSync(path.join(destination,name),JSON.stringify(value,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}finally{globalThis.fetch=original;await vite.close();}
