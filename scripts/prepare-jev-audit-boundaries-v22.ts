// Offline configuration registration only. No clients, jobs, consent or provider transport.
import {auditBoundaryManifest} from '../supabase/functions/_shared/jev-audit-boundaries-v22.ts';
globalThis.fetch=()=>{throw Error('PROVIDER_NETWORK_FORBIDDEN');};
const [output,migration]=Deno.args,m=await auditBoundaryManifest();
await Deno.writeTextFile(output,JSON.stringify(m,null,2));
if(migration){
 const config=JSON.stringify(m.configuration).replaceAll("'","''");
 const sql=`-- Append-only experimental config; existing RLS, guards and paid dispatch locks remain intact.\ninsert into public.analysis_jev_economy_configurations(id,config,config_sha256,instruction_sha256,threshold_sha256)\nvalues('${m.configuration.id}','${config}'::jsonb,'${m.config_sha256}','${m.instruction_sha256}','${m.threshold_sha256}')\non conflict(id) do nothing;\ndo $$ begin\n if not exists(select 1 from public.analysis_jev_economy_configurations where id='${m.configuration.id}' and config_sha256='${m.config_sha256}' and instruction_sha256='${m.instruction_sha256}' and threshold_sha256='${m.threshold_sha256}') then raise exception 'AUDIT_BOUNDARY_CONFIG_CONFLICT';end if;\nend $$;\n`;
 await Deno.writeTextFile(migration,sql);
}
console.log(JSON.stringify({id:m.configuration.id,config_sha256:m.config_sha256,instruction_sha256:m.instruction_sha256,threshold_sha256:m.threshold_sha256,new_paid_calls:0}));
