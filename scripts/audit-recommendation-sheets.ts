import {readFileSync,writeFileSync} from 'node:fs';
import {recommendationDatabase} from '../tests/fixtures/recommendation-sheet-database.ts';

// Explicit local input only. This script has no server client or network fallback.
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node --experimental-strip-types scripts/audit-recommendation-sheets.ts <saved-input.json> <output.json>');
globalThis.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
const saved=JSON.parse(readFileSync(input,'utf8'));
// Install the migration over the real saved publications, without seeding
// any live reviews or disposable processing table. This exercises backfill.
const db=await recommendationDatabase(async db=>{
 for(const org of new Set(saved.establishments.map((e:{organization_id:string})=>e.organization_id)))await db.query('insert into public.organizations values($1)',[org]);
 for(const e of saved.establishments)await db.query('insert into public.establishments values($1,$2,$3,$4,$5,$6,$7)',[e.id,e.organization_id,e.name,e.google_id,e.place_id,e.address,e.google_maps_url]);
 for(const p of saved.publications)await db.query('insert into public.current_report_publications select * from jsonb_populate_record(null::public.current_report_publications,$1)',[JSON.stringify(p)]);
});
try{
 const sheets=[];
 for(const identity of saved.establishments){
  const publications=saved.publications.filter((p:{establishment_id:string})=>p.establishment_id===identity.id);
  if(!publications.length){sheets.push({establishment_id:identity.id,name:identity.name,status:'no_report',global_score:null});continue;}
  for(const publication of publications){
   const {rows}=await db.query<{calculation:Record<string,unknown>;calculation_numeric_json:string;metadata:Record<string,unknown>}>(`select s.calculation,s.calculation::text calculation_numeric_json,private.recommendation_metadata_v1($3,$4,$5) metadata
    from public.restaurant_recommendation_sheets s where establishment_id=$1 and language=$2`,
    [identity.id,publication.language,JSON.stringify(identity),JSON.stringify(saved.metadata.find((m:{establishment_id:string})=>m.establishment_id===identity.id)??{}),JSON.stringify(publication.source_bindings)]);
   sheets.push({establishment_id:identity.id,name:identity.name,report_id:publication.report_id,source_run_id:publication.source_run_id,language:publication.language,report_generated_at:publication.generated_at,
    corpus:{total_reviews:publication.scope.review_count,period_start:publication.scope.period_start,period_end:publication.scope.period_end,fingerprint:publication.scope.fingerprint},
    stale:publication.stale,...rows[0]});
  }
 }
 const result={version:'internal-recommendation-v1',source_checked_at:saved.checked_at,execution:'local PostgreSQL, actual migration backfill over durable publication inputs',durable_projection_verified_without_live_reviews:true,provider_calls:0,production_writes:0,sheets};
 writeFileSync(output,JSON.stringify(result,null,2)+'\n');
 process.stdout.write(JSON.stringify({output,restaurants:saved.establishments.length,publications:saved.publications.length,calculable:sheets.filter(s=>'calculation'in s&&s.calculation.status==='ready').length,unavailable:sheets.filter(s=>'calculation'in s&&s.calculation.status!=='ready').map(s=>({name:s.name,issues:'calculation'in s?s.calculation.issues:[]}))})+'\n');
}finally{await db.close();}
