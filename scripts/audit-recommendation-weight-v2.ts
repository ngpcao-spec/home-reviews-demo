import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import type {PGlite} from '@electric-sql/pglite';
import {recommendationDatabase} from '../tests/fixtures/recommendation-sheet-database.ts';
import {independentScore,mean,agrees,fractionText,type CategoryInputs} from './lib/recommendation-weight-rational.ts';

const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node scripts/audit-recommendation-weight-v2.ts <private-snapshot.json> <private-output-directory>');
globalThis.fetch=async()=>{throw Error('NETWORK_FORBIDDEN')};
const saved=JSON.parse(readFileSync(input,'utf8'));
const categories=['quality','service','ambiance'] as const;
const categoryFields=['base_average','rating_sum','rating_count','positive','negative','denominator','score','score_numerator','score_denominator','classifications_coherent','ratings_coherent'];
type ExactCategory=CategoryInputs&{base_average:string|null;score:string|null;score_numerator:string|null;score_denominator:string|null};
type Exact=Record<typeof categories[number],ExactCategory>&{global:{score:string|null;score_numerator:string|null;score_denominator:string|null}};
const projection=`jsonb_build_object(${categories.map(c=>`'${c}',jsonb_build_object(${categoryFields.map(k=>`'${k}',c#>>'{categories,${c},${k}}'`).join(',')})`).join(',')},'global',jsonb_build_object('score',c->>'global_score','score_numerator',c->>'global_score_numerator','score_denominator',c->>'global_score_denominator'))`;
async function exact(db:PGlite,sql:string,args:unknown[]){return (await db.query<{v:Exact}>(`with x as(${sql})select ${projection} v from x`,args)).rows[0].v;}
function verify(ex:Exact,weight:2|4){
 const values=categories.map(c=>independentScore(ex[c],weight));
 categories.forEach((c,i)=>{if(!agrees(values[i],ex[c].score_numerator,ex[c].score_denominator))throw Error('INDEPENDENT_CATEGORY_MISMATCH:'+c)});
 if(!agrees(mean(values),ex.global.score_numerator,ex.global.score_denominator))throw Error('INDEPENDENT_GLOBAL_MISMATCH');
 return Object.fromEntries([...categories.map((c,i)=>[c,fractionText(values[i])]),['global',fractionText(mean(values))]]);
}
const db=await recommendationDatabase(async db=>{
 for(const org of new Set(saved.sheets.map((s:{organization_id:string})=>s.organization_id)))await db.query('insert into public.organizations values($1)',[org]);
 for(const s of saved.sheets){const e=s.metadata.identity;await db.query('insert into public.establishments values($1,$2,$3,$4,$5,$6,$7)',[s.establishment_id,s.organization_id,e.name,e.google_id,e.place_id,e.address,e.google_maps_url]);}
 for(const p of saved.publications)await db.query('insert into public.current_report_publications select * from jsonb_populate_record(null::public.current_report_publications,$1)',[JSON.stringify(p)]);
});
try{
 const before=new Map<string,Exact>(),frozen=new Map<string,Record<string,unknown>>();
 for(const s of saved.sheets){
  await db.query(`update public.restaurant_recommendation_sheets set calculation=$3::jsonb,metadata=$4,report_sections=$5,corpus=$6,
   stale=$7,stale_reason=$8,calculated_at=$9,updated_at=$10 where establishment_id=$1 and language=$2`,
   [s.establishment_id,s.language,s.calculation_json,s.metadata,s.report_sections,s.corpus,s.stale,s.stale_reason,s.calculated_at,s.updated_at]);
  const ex=await exact(db,'select calculation c from public.restaurant_recommendation_sheets where establishment_id=$1 and language=$2',[s.establishment_id,s.language]);
  const pub=saved.publications.find((p:{establishment_id:string;language:string;report_id:string})=>p.establishment_id===s.establishment_id&&p.language===s.language&&p.report_id===s.report_id);
  if(!pub||pub.source_run_id!==s.source_run_id)throw Error('OWN_PUBLICATION_MISSING');
  const replay=await exact(db,'select private.recommendation_calculation_v1($1) c',[JSON.stringify(pub)]);
  for(const c of categories)for(const k of ['rating_sum','rating_count','positive','negative','denominator'] as const)if(ex[c][k]!==replay[c][k])throw Error('FROZEN_COMPONENT_MISMATCH:'+c+':'+k);
  verify(ex,2);verify(replay,2);before.set(s.establishment_id+':'+s.language,ex);
  frozen.set(s.establishment_id+':'+s.language,(await db.query<{v:Record<string,unknown>}>('select to_jsonb(s) v from public.restaurant_recommendation_sheets s where establishment_id=$1 and language=$2',[s.establishment_id,s.language])).rows[0].v);
 }
 const pubsBefore=(await db.query('select to_jsonb(p)::text body from public.current_report_publications p order by establishment_id,language')).rows;
 await db.exec(readFileSync('supabase/migrations/20261028121845_recommendation_negative_weight_4.sql','utf8'));
 if(JSON.stringify((await db.query('select to_jsonb(p)::text body from public.current_report_publications p order by establishment_id,language')).rows)!==JSON.stringify(pubsBefore))throw Error('PUBLICATION_MUTATED');
 if((await db.query('select count(*)::int n from public.reviews')).rows[0].n!==0)throw Error('LIVE_REVIEWS_NOT_ALLOWED');
 const rows=[];
 for(const s of saved.sheets){
  const after=await exact(db,'select calculation c from public.restaurant_recommendation_sheets where establishment_id=$1 and language=$2',[s.establishment_id,s.language]);
  const old=before.get(s.establishment_id+':'+s.language)!;const independent=verify(after,4);
  const sheet=(await db.query<{v:Record<string,unknown>}>('select to_jsonb(s) v from public.restaurant_recommendation_sheets s where establishment_id=$1 and language=$2',[s.establishment_id,s.language])).rows[0].v;
  const localBefore=frozen.get(s.establishment_id+':'+s.language)!;
  for(const k of ['report_id','source_run_id','report_generated_at','corpus','metadata','report_sections','stale','stale_reason'])if(JSON.stringify(sheet[k])!==JSON.stringify(localBefore[k]))throw Error('PRESERVATION_MISMATCH:'+k);
  const comparison=Object.fromEntries([...categories,'global' as const].map(c=>[c,{before:old[c].score,after:after[c].score,
   ...('rating_sum'in after[c]?{base:after[c].base_average,ratings:after[c].rating_count,positive:after[c].positive,negative:after[c].negative,total:after[c].denominator}:{}),
   numerator:after[c].score_numerator,denominator:after[c].score_denominator,independent_fraction:independent[c]}]));
  rows.push({name:s.metadata.identity.name,establishment_id:s.establishment_id,language:s.language,report_id:s.report_id,source_run_id:s.source_run_id,
   report_date:s.report_generated_at,stale:s.stale,stale_reason:s.stale_reason,corpus:s.corpus,comparison});
 }
 mkdirSync(output,{recursive:true});
 const result={version:'internal-recommendation-v2',negative_weight:-4,source_checked_at:saved.checked_at,network_calls:0,live_reviews_loaded:0,
  publications_unchanged:true,stale_states_preserved:true,independent_rational_checks:true,rows};
 writeFileSync(join(output,'comparison.json'),JSON.stringify(result,null,2)+'\n');
 const quote=(v:unknown)=>'"'+String(v??'').replaceAll('"','""')+'"';
 const csv=[['restaurant','langue','rapport','date_rapport','a_actualiser','rubrique','base','effectif_notes','positifs_exclusifs','negatifs_exclusifs','total_corpus','avant','apres','numerateur_apres','denominateur_apres']];
 for(const r of rows)for(const c of [...categories,'global' as const]){const v=r.comparison[c];csv.push([r.name,r.language,r.report_id,r.report_date,String(r.stale),c,'base'in v?v.base??'':'','ratings'in v?v.ratings:'','positive'in v?v.positive:'','negative'in v?v.negative:'','total'in v?v.total:'',v.before??'',v.after??'',v.numerator??'',v.denominator??'']);}
 writeFileSync(join(output,'comparison.csv'),'\uFEFF'+csv.map(r=>r.map(quote).join(';')).join('\n')+'\n');
 const escape=(s:unknown)=>String(s??'—').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const display=(s:string|null)=>s===null?'—':Number(s).toLocaleString('fr-FR',{minimumFractionDigits:3,maximumFractionDigits:3});
 const labels:Record<string,string>={quality:'Qualité des plats',service:'Service',ambiance:'Ambiance',global:'Global'};
 const head='<tr><th>Restaurant · rapport</th><th>État</th>'+[...categories,'global'].map(c=>`<th>${escape(labels[c])} avant → après</th>`).join('')+'</tr>';
 const summary=rows.map(r=>'<tr><th>'+escape(r.name)+'<small>'+escape(r.language)+' · '+escape(r.report_date)+'</small></th><td>'+(r.stale?'À actualiser':'À jour')+'</td>'+[...categories,'global' as const].map(c=>'<td>'+display(r.comparison[c].before)+' → <b>'+display(r.comparison[c].after)+'</b></td>').join('')+'</tr>').join('');
 const details=rows.flatMap(r=>categories.map(c=>{const v=r.comparison[c];return '<tr><th>'+escape(r.name)+'</th><td>'+labels[c]+'</td>'+[v.base,v.ratings,v.positive,v.negative,v.total,v.before,v.after].map(x=>'<td>'+escape(x)+'</td>').join('')+'</tr>'})).join('');
 writeFileSync(join(output,'bilan.html'),`<!doctype html><html lang="fr"><meta charset="utf-8"><title>Comparatif privé — pondération −4</title><style>body{font:16px system-ui;background:#f8f6f1;color:#252921;margin:30px}main{max-width:1300px;margin:auto}h1{font-size:30px}table{border-collapse:collapse;width:100%;background:white;margin:24px 0}th,td{padding:12px;border:1px solid #dadbd3;text-align:left}small{display:block;font-weight:400;color:#666}td{font-variant-numeric:tabular-nums}p{max-width:1000px;line-height:1.6}.scroll{overflow:auto}</style><main><h1>Fiches internes · négatif −2 → −4</h1><p>Document privé. Sources : publications durables figées au ${escape(saved.checked_at)}. Aucun avis actuel chargé, aucun appel fournisseur. Tous les statuts et références sont préservés. V2 : clamp(B + (P − 4N) / T, 0, 6). Mixte, neutre et sans mention : 0. Le global exige les trois rubriques.</p><p>Résumé arrondi à trois décimales pour présentation uniquement. Les valeurs complètes et les fractions exactes sont dans les fichiers JSON et CSV. Chaque fraction a été vérifiée indépendamment avec des entiers arbitraires.</p><div class="scroll"><table>${head}${summary}</table></div><h2>Détail par rubrique</h2><div class="scroll"><table><tr><th>Restaurant</th><th>Rubrique</th><th>B</th><th>Notes</th><th>P exclusif</th><th>N exclusif</th><th>T</th><th>Avant</th><th>Après</th></tr>${details}</table></div><p>Vérifications : publications inchangées, statuts conservés, absence de lecture des avis actuels, calcul rationnel indépendant. Ce score reste distinct des étoiles Google et des notes des rapports.</p></main></html>`);
 process.stdout.write(JSON.stringify({output,sheets:rows.length,stale:rows.filter(r=>r.stale).length,independent_checks:true,network_calls:0})+'\n');
}finally{await db.close();}
