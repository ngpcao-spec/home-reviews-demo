// Existing queue and provider transport; no new execution engine.
 // deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {restaurantPort} from './jls-restaurant-store.ts';
import {processRestaurant} from './jls-restaurant-worker.ts';
import {SHORT_COMPARE,shortContract,verifyShortComparison,parseShortJev,type ShortBody} from './direct4-short-comparison.ts';
import {DIRECT_CATEGORY_KEYS,DIRECT_NATIVE_CHOICES,directHash} from './jev-direct-categories.ts';
import {parseLunaDirect4} from './luna-direct4-comparison.ts';
export async function processShortComparison(admin:SupabaseClient,run:string,keys:{jev:string;openai:string},http:typeof fetch){
 const port=restaurantPort(admin),s=await port.load(run);
 if(!['queued','running'].includes(s.run.status)||s.run.consent?.consent_source==='technical_qualification_no_spending')return;
 if(s.protocol.body.version!==SHORT_COMPARE||!['jev','luna'].includes(s.run.stage))throw Error('SHORT_COMPARISON_SCOPE_CHANGED');
 await processRestaurant(port,run,keys,http,shortContract());
}
export async function probeShortComparison(admin:SupabaseClient,id:string){
 const r=await admin.from('analysis_jls_restaurant_protocols').select('id,body,sha256').eq('id',id).single();
 if(r.error)throw Error('FORBIDDEN');await verifyShortComparison(r.data.body as ShortBody,r.data.sha256);
 const probabilities=Object.fromEntries(DIRECT_NATIVE_CHOICES.map(v=>[v,v==='uncertain'?1:0]));
 const j=parseShortJev({model:'jev-1.13.0',usage:{input_tokens:1,output_tokens:0},answers:Object.fromEntries(DIRECT_CATEGORY_KEYS.map(k=>[k,{type:'choice',choice:'uncertain',confidence:0,probabilities}]))});
 const l=parseLunaDirect4({model:'gpt-6-luna',usage:{input_tokens:1,output_tokens:0,total_tokens:1},answers:DIRECT_CATEGORY_KEYS.map(name=>({name,type:'choice',choice:'uncertain',confidence:0,probabilities:DIRECT_NATIVE_CHOICES.map(value=>({value,probability:probabilities[value]}))}))});
 const b={version:SHORT_COMPARE,protocol_sha256:r.data.sha256,passed:true,provider_calls:0,
 native_uncertain_preserved:DIRECT_CATEGORY_KEYS.every(k=>j.categories[k].native_choice==='uncertain'&&l.categories[k].native_choice==='uncertain'),
 no_threshold:true,worker_route_present:true,execution_id:Deno.env.get('SB_EXECUTION_ID')??null};
 const saved=await admin.rpc('save_jls_snapshot_preparation',{p_protocol:id,p_kind:'short_common_deployed_probe',p_body:b,p_sha:await directHash(b)});
 if(saved.error)throw Error('SHORT_COMPARISON_PROBE_SAVE_FAILED');return {archive_id:saved.data,...b};
}
