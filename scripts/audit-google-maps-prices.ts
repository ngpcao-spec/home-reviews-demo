import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,relative,sep} from 'node:path';
import {recommendationDatabase} from '../tests/fixtures/recommendation-sheet-database.ts';
import {prices,recommendRestaurants,type SheetRow,type Point} from '../supabase/functions/_shared/restaurant-recommendation-engine-v1.ts';
import {googleMoneyRange} from '../supabase/functions/_shared/google-maps-prices.ts';
globalThis.fetch=(()=>{throw Error('NETWORK_FORBIDDEN')}) as typeof fetch;
const [input,exactFile,out]=process.argv.slice(2);
if(!input||!exactFile||!out)throw Error('USAGE: <private snapshot> <exact calculations> <private output outside repository>');
const rel=relative(resolve('.'),resolve(out));if(!rel.startsWith('..'+sep)&&rel!=='..'&&!/^[A-Za-z]:/.test(rel))throw Error('PRIVATE_OUTPUT_REQUIRED');
type Obj=Record<string,unknown>;
type Row={establishment:{id:string;organization_id:string;name:string;place_id:string;google_id:string};sheet:Obj|null;publication:Obj|null;observations:{id:string;review_id:string;provider:string;observed_at:string;raw:Obj}[]};
const snapshot=JSON.parse(readFileSync(input,'utf8')) as {at:string;rows:Row[]};
const exact=JSON.parse(readFileSync(exactFile,'utf8')) as {report_id:string;calculation_json:string}[];
const db=await recommendationDatabase();
await db.exec(`create table public.establishment_snapshots(id uuid primary key default gen_random_uuid(),establishment_id uuid,organization_id uuid,captured_at timestamptz,provider text,raw_place_payload jsonb);`);
await db.exec(readFileSync('supabase/migrations/20261028121845_recommendation_negative_weight_4.sql','utf8'));
for(const r of snapshot.rows){const e=r.establishment;
 await db.query('insert into public.organizations values($1) on conflict do nothing',[e.organization_id]);
 await db.query('insert into public.establishments(id,organization_id,name,google_id,place_id) values($1,$2,$3,$4,$5)',[e.id,e.organization_id,e.name,e.google_id,e.place_id]);
 for(const o of r.observations??[]) {
  await db.query('insert into public.reviews(id,organization_id,establishment_id) values($1,$2,$3) on conflict do nothing',[o.review_id,e.organization_id,e.id]);
  await db.query('insert into public.review_provider_payloads(id,review_id,provider,raw_payload,provider_last_seen_at) values($1,$2,$3,$4,$5)',[o.id,o.review_id,o.provider,JSON.stringify(o.raw),o.observed_at]);
 }
 if(!r.publication||!r.sheet)continue;
 await db.query('insert into public.current_report_publications select * from jsonb_populate_record(null::public.current_report_publications,$1)',[JSON.stringify(r.publication)]);
 const calc=exact.find(x=>x.report_id===r.sheet!.report_id)?.calculation_json;if(!calc)throw Error('EXACT_FROZEN_CALCULATION_MISSING');
 // Exclude generated columns; restore the exact original calculation via SQL JSON.
 const fields=Object.keys(r.sheet).filter(k=>!['quality_score','service_score','ambiance_score','global_score'].includes(k));
 await db.query('delete from public.restaurant_recommendation_sheets where establishment_id=$1',[e.id]);
 await db.query(`insert into public.restaurant_recommendation_sheets(${fields.join(',')}) select ${fields.join(',')} from jsonb_populate_record(null::public.restaurant_recommendation_sheets,jsonb_set($1::jsonb,'{calculation}',$2::jsonb))`,[JSON.stringify(r.sheet),calc]);
}
const protectedSql="select establishment_id::text,md5((to_jsonb(s)-'metadata'-'updated_at')::text) sheet,md5((metadata-'budget')::text) other_metadata from public.restaurant_recommendation_sheets s order by 1";
const before=(await db.query(protectedSql)).rows;
const pubs=(await db.query('select md5(to_jsonb(p)::text) hash from public.current_report_publications p order by establishment_id,language')).rows;
await db.exec(readFileSync('supabase/migrations/20261028133850_google_maps_price_provenance.sql','utf8'));
if(JSON.stringify(before)!==JSON.stringify((await db.query(protectedSql)).rows))throw Error('PROTECTED_SHEET_FIELDS_CHANGED');
if(JSON.stringify(pubs)!==JSON.stringify((await db.query('select md5(to_jsonb(p)::text) hash from public.current_report_publications p order by establishment_id,language')).rows))throw Error('REPORT_CHANGED');
const results=[];
const engineRows:SheetRow[]=[];
for(const r of snapshot.rows){
 const record=(await db.query<{metadata:Obj}>('select metadata from public.restaurant_recommendation_sheets where establishment_id=$1',[r.establishment.id])).rows[0];
 const budget=record?prices(record.metadata):null;
 if(record&&r.sheet&&r.publication){const p=r.publication;
  engineRows.push({...r.sheet,metadata:record.metadata,calculation_text:exact.find(x=>x.report_id===r.sheet!.report_id)!.calculation_json,
   publication:{...p,derived:(p.document as Obj).derived_report}} as unknown as SheetRow);
 }
 const rawSpending=(r.observations??[]).flatMap(o=>{
  const context=o.raw.reviewContext as Obj|null;
  return Object.entries(context??{}).filter(([k,v])=>['giá mỗi người','prix par personne','price per person'].includes(k.toLowerCase())&&typeof v==='string').map(([key,value])=>({review_id:o.review_id,key,value,observed_at:o.observed_at,parsed:googleMoneyRange(value)}));
 });
 const missing=budget?.customer_spend_per_person.ranges.filter(x=>x.parsed.status!=='parsed')??[];
 const obj={establishment_id:r.establishment.id,name:r.establishment.name,report_id:r.sheet?.report_id??null,stale:r.sheet?.stale??null,budget,raw_reviews:r.observations?.length??0,
  raw_establishment_prices:(r.observations??[]).filter(o=>o.raw.price!==null&&o.raw.price!==undefined).length,raw_spending_reviews:new Set(rawSpending.map(x=>x.review_id)).size,raw_spending_labels:[...new Set(rawSpending.map(x=>x.value))],unparsed_spending_labels:missing.map(x=>x.value)};
 results.push(obj);
}
const origin=(engineRows.find(r=>!r.stale)?.metadata.google_metadata as {coordinates:Point})?.coordinates;
const budgetCheck=origin&&engineRows.length?recommendRestaurants(engineRows,engineRows[0].organization_id,engineRows[0].language,{origin,area:{kind:'radius',metres:100000},budget:{kind:'amount',currency:'VND',maximum:300000}}):null;
if(budgetCheck?.proposals.length)throw Error('UNKNOWN_ESTABLISHMENT_PRICE_PASSED_BUDGET_FILTER');
const summary={at:snapshot.at,migration:'20261028133850_google_maps_price_provenance.sql',mode:'offline replay only; not deployed',restaurants:results.length,sheets:before.length,actual_sheet_budget_filter_matches:budgetCheck?.proposals.length??null,
 known_establishment_prices:results.filter(r=>r.budget?.establishment.status==='known').length,raw_reviews:results.reduce((n,r)=>n+r.raw_reviews,0),raw_spending_reviews:results.reduce((n,r)=>n+r.raw_spending_reviews,0),
 frozen_spending_reviews:results.reduce((n,r)=>n+(r.budget?.customer_spend_per_person.ranges.reduce((s,x)=>s+x.review_count,0)??0),0),unparsed_labels:[...new Set(results.flatMap(r=>r.unparsed_spending_labels))],
 scores_reports_references_stale_preserved:true,provider_calls:0,results};
mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'results.json'),JSON.stringify(summary,null,2));
const esc=(v:unknown)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const rows=results.map(r=>`<tr><th>${esc(r.name)}</th><td>${r.budget?.establishment.status==='known'?esc(JSON.stringify(r.budget.establishment.raw)):'Non renseigné'}</td><td>${esc(r.budget?.establishment.source_table)}.raw_payload.price</td><td>Niveau/fourchette établissement</td><td>${esc(r.budget?.establishment.observed_at)}<small>Date fournisseur : ${esc(r.budget?.establishment.provider_scraped_at)}</small></td><td>${esc(r.budget?.establishment.missing_reason??'NO_REPORT_SHEET')}</td><td>${r.raw_spending_reviews} dans les bruts actuels ; ${r.budget?.customer_spend_per_person.ranges.reduce((n,x)=>n+x.review_count,0)??0} dans le rapport figé</td></tr>`).join('');
const details=results.map(r=>`<details><summary>${esc(r.name)} — dépenses clients</summary><p>Rapport ${esc(r.report_id)}, ${r.stale?'À actualiser':'source non marquée obsolète'}. Les effectifs courants et figés peuvent différer : aucune copie de prix courant dans un ancien corpus.</p><table><tr><th>Libellé Google original</th><th>Clients distincts</th><th>Normalisation</th><th>Source et période</th></tr>${(r.budget?.customer_spend_per_person.ranges??[]).map(x=>`<tr><td>${esc(x.value)}</td><td>${x.review_count}</td><td>${esc(JSON.stringify(x.parsed))}</td><td>${esc(x.source_fields.join(', '))}<small>${esc(x.period_start)} → ${esc(x.period_end)}</small></td></tr>`).join('')}</table><p>Observation du corpus : ${esc(r.budget?.customer_spend_per_person.observed_at)} ; aucun de ces montants n'est un tarif garanti ni utilisé pour respecter un budget explicite.</p></details>`).join('');
writeFileSync(resolve(out,'bilan.html'),`<!doctype html><html lang="fr"><meta charset="utf-8"><title>Prix Google Maps · bilan privé</title><style>body{font:16px system-ui;line-height:1.6;background:#f6f4ef;color:#242824;margin:28px}main{max-width:1400px;margin:auto}table{border-collapse:collapse;width:100%;background:white}td,th{border:1px solid #ddd;padding:10px;text-align:left}small{display:block;color:#666}details{background:white;padding:20px;margin-top:20px}summary{cursor:pointer;font-weight:bold}.scroll{overflow:auto}</style><main><h1>Prix Google Maps · bilan privé</h1><p>Snapshot SELECT du ${esc(snapshot.at)}. ${summary.restaurants} restaurants, ${summary.sheets} fiches, ${summary.raw_reviews} bruts. Rejeu de la correction hors réseau : scores, références, rapports et statuts inchangés. Aucun déploiement ni appel fournisseur.</p><p><b>${summary.known_establishment_prices} prix d'établissement récupérable.</b> Le champ <code>price</code> est nul dans les réponses conservées ; aucun autre champ de niveau/fourchette n'y figure. C'est une absence dans la réponse reçue, pas la preuve que Google n'affiche aucun prix. ${summary.raw_spending_reviews} avis actuels possèdent une dépense client, ${summary.frozen_spending_reviews} sont présents dans les corpus figés. Ces dépenses restent distinctes du prix d'établissement.</p><div class="scroll"><table><tr><th>Restaurant</th><th>Prix trouvé</th><th>Champ source</th><th>Type</th><th>Date réelle</th><th>Cause des manques</th><th>Dépenses clients</th></tr>${rows}</table></div>${details}<h2>Acteur et limites prouvées</h2><p>Le code utilise <code>compass~google-maps-reviews-scraper</code>, sans build épinglé. Le build exact des runs historiques n'est pas conservé : non vérifiable depuis ces seules données. Le <a href="https://apify.com/compass/google-maps-reviews-scraper/input-schema">schéma officiel actuel</a> ne comporte pas d'option de récupération de prix ; l'<a href="https://apify.com/compass/google-maps-reviews-scraper">exemple de sortie officiel</a> contient un champ price nullable. Le schéma actuel ne prouve pas celui d'un ancien build.</p><p>Deux pertes futures sont corrigées dans le code : omission des prix du rawPlacePayload normalisé, puis effacement complet des snapshots de fiche. Une liste autorisée conserve désormais uniquement placeId/cid, price/priceLevel/priceRange et scrapedAt ; aucun texte d'avis ou d'auteur. La migration prépare le budget des fiches depuis les données existantes et le rafraîchit après un nouveau snapshot, sans recalcul de score et avec les dépenses de leur propre publication figée.</p><h2>Collecte éventuellement nécessaire, non lancée</h2><p>Pour obtenir les prix d'établissement manquants : une lecture des seules fiches Google des ${summary.restaurants} identifiants déjà connus, dans la langue choisie, sans avis supplémentaires. Le <a href="https://apify.com/compass/crawler-google-places/input-schema">schéma d'un acteur de fiches</a> permet maxReviews=0 et scrapePlaceDetailPage ; sa <a href="https://apify.com/compass/crawler-google-places">sortie documente price</a>. Périmètre proposé : URLs/IDs exacts, au plus une fiche par URL, maxReviews=0, aucun enrichissement de contacts, photos ou analyse. Ce serait une collecte distincte à autoriser, sans garantie que Google retourne les prix. Aucun run n'est créé, aucune option de l'acteur existant n'est changée.</p><p>Les montants non ambigus VND (N/Tr, séparateurs, ₫), EUR et codes explicites sont normalisés ; devises ambiguës et bornes ouvertes ne deviennent pas une fourchette fermée. Les bruts et libellés restent intacts. Une dépense client ne devient jamais un prix garanti.</p></main></html>`);
console.log(JSON.stringify({...summary,results:undefined}));await db.close();
