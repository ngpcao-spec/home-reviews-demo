// Small contract routing adapter; no second execution engine.
// deno-lint-ignore no-import-prefix
import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.117.2';
import {restaurantPort} from './jls-restaurant-store.ts';
import {processRestaurant} from './jls-restaurant-worker.ts';
import {lunaComparisonContract,parseLunaDirect4,LUNA_DIRECT4_COMPARE,verifyLunaComparison,type LunaComparisonBody} from './luna-direct4-comparison.ts';
import {DIRECT_CATEGORY_KEYS,DIRECT_NATIVE_CHOICES,directHash} from './jev-direct-categories.ts';
export async function processLunaDirect4Comparison(admin:SupabaseClient,run:string,key:string,http:typeof fetch){
 const port=restaurantPort(admin),s=await port.load(run);
 if(!['queued','running'].includes(s.run.status))return;
 if(s.run.consent?.consent_source==='technical_qualification_no_spending')return;
 if(s.protocol.body.version!==LUNA_DIRECT4_COMPARE||s.run.stage!=='luna')throw Error('LUNA_DIRECT4_SCOPE_CHANGED');
 await processRestaurant(port,run,{jev:'',openai:key},http,lunaComparisonContract());
}
export async function probeLunaDirect4Comparison(admin:SupabaseClient,id:string){
 const p=await admin.from('analysis_jls_restaurant_protocols').select('id,body,sha256').eq('id',id).single();
 if(p.error)throw Error('FORBIDDEN');await verifyLunaComparison(p.data.body as LunaComparisonBody,p.data.sha256);
 const raw={model:'gpt-6-luna',usage:{input_tokens:1,output_tokens:0,total_tokens:1},answers:DIRECT_CATEGORY_KEYS.map(name=>({name,type:'choice',choice:'uncertain',confidence:.1,
  probabilities:DIRECT_NATIVE_CHOICES.map(value=>({value,probability:value==='uncertain'?1:0}))}))};
 const parsed=parseLunaDirect4(raw);
 const b={version:LUNA_DIRECT4_COMPARE,protocol_sha256:p.data.sha256,provider_calls:0,passed:true,
  native_uncertain_preserved:DIRECT_CATEGORY_KEYS.every(k=>parsed.categories[k].native_choice==='uncertain'),
  no_threshold:true,worker_route_present:true,execution_id:Deno.env.get('SB_EXECUTION_ID')??null};
 const saved=await admin.rpc('save_jls_snapshot_preparation',{p_protocol:id,p_kind:'luna_direct4_deployed_probe',p_body:b,p_sha:await directHash(b)});
 if(saved.error)throw Error('LUNA_DIRECT4_PROBE_SAVE_FAILED');return {archive_id:saved.data,...b};
}
