import {add, compare, exactJson, quotient, rational, subtract, type Rational} from './restaurant-recommendation-numbers.ts';
import {PLACE_FEATURES,placeFeatureLabel,placeCategories,taxonomyValue,type TaxonomyKind} from './google-place-taxonomy.ts';
import {scheduledOpening,PLACE_PROFILE_VERSION,type PlaceProfile} from './google-place-profile.ts';
import {googleMoneyRange,googlePriceLevel,googlePerPersonPriceLabel,type MoneyRange} from './google-maps-prices.ts';

export const RECOMMENDATION_ENGINE_VERSION = 'restaurant-recommendation-engine-v4';
export const COMPARABLE_SCORE_GAP = '0.10';
export const COMPARABLE_DISTANCE_METRES = 250;
export const CATEGORIES = ['quality', 'service', 'ambiance'] as const;
export type Category = typeof CATEGORIES[number];
export type Point = {latitude: number; longitude: number};
export type Area = {kind: 'radius'; metres: number} | {kind: 'bounds'; south: number; north: number; west: number; east: number};
// Amount budgets are per person, including legacy requests that omit the unit.
export type Budget = {kind: 'price_level'; allowed: number[]} | {kind: 'amount'; currency: string; maximum: number; minimum?: number; unit?: 'per_person'};
export type Request = ({origin: Point; area: Area; geography?:never} | {geography:'not_requested';origin?:never;area?:never}) & {
  cuisines?: string[]; specialties?: string[]; usages?: string[]; budget?: Budget;
  visit_at?: string; hours_kind?: 'venue'|'kitchen'|'delivery'|'takeaway'|'breakfast';
  preferences?: {categories?: Category[]; features?: string[]}; required_features?: string[];
};
type Obj = Record<string, unknown>;
export type SheetRow = {
  establishment_id: string; organization_id: string; language: string; report_id: string; source_run_id: string;
  report_generated_at: string; calculation_version: string; stale: boolean; stale_reason: string | null;
  corpus: Obj; metadata: Obj; report_sections: Obj; calculation_text: string;
  publication: {report_id: string; source_run_id: string; organization_id: string; establishment_id: string; language: string;
    scope: Obj; stale: boolean; stale_reason?:string|null; generated_at: string; derived: Obj} | null;
};
export type Score = {value: string; numerator: string; denominator: string};
export type Citation = {report_id: string; section: 'positive_aspects' | 'reservations'; index: number; category: string; text: string; evidence_ids: string[]};
export type Prices = {
  establishment: {status: 'known' | 'unknown'; source: string | null; observed_at: string | null; level: number | null;
    range: {currency: string; minimum: number; maximum: number} | null; raw: Obj;source_fields:string[];source_table:string|null;provider_scraped_at:string|null;missing_reason:string|null;
    label:string;unit:'per_person'|null;unit_status:'confirmed'|'unknown';unit_label:string;indicative:true;guaranteed_tariff:false};
  customer_spend_per_person: {source: string | null; status: string | null; observed_at: string | null; guaranteed_tariff: false; ranges: {value: string; review_count: number; parsed:MoneyRange; source_fields:string[]; period_start:string|null; period_end:string|null}[]};
};
export type Proposal = {
  establishment_id: string; name: string; distance_metres: number|null; distance_kind: 'straight_line'|'not_requested';
  cuisines: {values: string[]; source: string | null; observed_at: string | null};
  scores: Record<Category, Score> & {global: Score}; budget: Prices; budget_match: 'not_requested' | 'google_level' | 'google_range';
  reasons: {code: string; category?: Category; feature?: string; citations?: Citation[]}[]; reservations: Citation[];
  features: Record<string, {status: 'reported' | 'denied' | 'conflicted' | 'not_documented'; citations: Citation[]; label?:string; google?:unknown}>;
  practical:PlaceProfile|null; specialties:string[]; usages:string[];
  opening:{status:'not_requested'|'scheduled_open'; live:false; holiday_guarantee:false};
  contradictions:{feature:string; google:unknown; citations:Citation[]}[];
  report: {id: string; generated_at: string; language: string; freshness: 'current'|'corpus_changed'; corpus: Obj};
};
type Candidate = {proposal: Proposal; global: Rational; preference: Rational; matches: number; band: number; preference_band: number};
export type Result = {
  version: string; comparable_score_gap: string; proposals: Proposal[];
  excluded: {establishment_id: string; name: string; report_id: string; reasons: string[]}[];
  notices: string[]; refinements: {kind: 'closer' | 'lower_price_level' | 'lower_price_range' | 'documented_feature'; feature?:string; from_id: string; alternative_id: string}[];
};
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const str = (v: unknown) => typeof v === 'string' ? v : null;
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const key = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
const cuisine=(s:string)=>taxonomyValue('cuisines',s)??key(s);
function documentedTaxonomy(google:Obj,profile:PlaceProfile|null,kind:TaxonomyKind){
 if(profile)return profile.categories[kind];
 if(google.source!=='google_maps_import')return [];
 const labels=[...list(google.cuisine_types),...list(google.google_categories)].filter((s):s is string=>typeof s==='string');
 return placeCategories(labels)[kind];
}
function practicalProfile(row:SheetRow):PlaceProfile|null{
 const p=obj(row.metadata.google_place_profile),i=obj(p.identity),binding=obj(p.binding),identity=obj(row.metadata.identity);
 return p.version===PLACE_PROFILE_VERSION&&binding.establishment_id===row.establishment_id&&binding.organization_id===row.organization_id
  &&i.source==='google_maps_place_details'&&typeof i.observed_at==='string'&&Number.isFinite(Date.parse(i.observed_at))
  &&(!identity.google_id||i.cid===identity.google_id)&&(!identity.place_id||i.place_id===identity.place_id)
  &&p.categories&&p.hours&&p.attributes&&p.contacts ? p as PlaceProfile : null;
}
const canonical = (v: unknown): string => JSON.stringify(Array.isArray(v) ? v.map(x => JSON.parse(canonical(x))) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, JSON.parse(canonical((v as Obj)[k]))])) : v);
export function validPoint(p: Point) {return Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;}
/** Great-circle distance, not a route length or journey time. */
export function distanceMetres(a: Point, b: Point) {
  const rad = Math.PI / 180, dl = (b.latitude - a.latitude) * rad, dn = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dn / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
function validateRequest(r: Request) {
  if(r.geography==='not_requested') {
    if(r.origin!==undefined||r.area!==undefined)throw Error('INVALID_AREA');
  } else {
  if (!validPoint(r.origin)) throw Error('POSITION_REQUIRED');
  if (r.area?.kind === 'radius') {if (!Number.isFinite(r.area.metres) || r.area.metres <= 0) throw Error('INVALID_AREA');}
  else if (r.area?.kind === 'bounds') {
    if (!validPoint({latitude:r.area.south,longitude:r.area.west}) || !validPoint({latitude:r.area.north,longitude:r.area.east}) || r.area.south > r.area.north) throw Error('INVALID_AREA');
  } else throw Error('AREA_REQUIRED');
  }
  if (r.budget?.kind === 'price_level') {
    if (!r.budget.allowed.length || r.budget.allowed.some(x => !Number.isInteger(x) || x < 0 || x > 4)) throw Error('INVALID_BUDGET');
  } else if (r.budget) {
    if (r.budget.kind !== 'amount' || r.budget.unit !== undefined && r.budget.unit !== 'per_person'
      || !/^[A-Z]{3}$/.test(r.budget.currency) || !Number.isFinite(r.budget.maximum) || r.budget.maximum < 0
      || r.budget.minimum !== undefined && (!Number.isFinite(r.budget.minimum) || r.budget.minimum < 0 || r.budget.minimum > r.budget.maximum)) throw Error('INVALID_BUDGET');
  }
  if (r.preferences?.categories?.some(c => !CATEGORIES.includes(c))) throw Error('INVALID_CATEGORY_PREFERENCE');
  if ([...(r.cuisines??[]),...(r.specialties??[]),...(r.usages??[])].some(c=>typeof c!=='string'||!c.trim())) throw Error('INVALID_CUISINE');
  if(r.visit_at&&(!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(r.visit_at)||!Number.isFinite(Date.parse(r.visit_at))))throw Error('INVALID_VISIT_TIME');
  if(r.hours_kind&&!['venue','kitchen','delivery','takeaway','breakfast'].includes(r.hours_kind))throw Error('INVALID_HOURS_KIND');
  if ([...(r.preferences?.features ?? []),...(r.required_features ?? [])].some(f => typeof f !== 'string' || !/^[a-z_]{1,40}$/.test(f))) throw Error('INVALID_FEATURE');
}
function inArea(p: Point, distance: number, area: Area) {
  if (area.kind === 'radius') return distance <= area.metres;
  return p.latitude >= area.south && p.latitude <= area.north && (area.west <= area.east ? p.longitude >= area.west && p.longitude <= area.east : p.longitude >= area.west || p.longitude <= area.east);
}
function score(v: Obj, prefix = 'score'): {out: Score; exact: Rational} {
  const value = str(v[prefix]), n = str(v[prefix + '_numerator']), d = str(v[prefix + '_denominator']);
  if (value === null || n === null || d === null) throw Error('MISSING_SCORES');
  const exact = quotient(n, d);
  if (compare(exact, rational('0')) < 0 || compare(exact, rational('6')) > 0) throw Error('INVALID_SCORES');
  return {out: {value, numerator: n, denominator: d}, exact};
}
function citations(row: SheetRow, section: Citation['section']): Citation[] {
  return list(row.report_sections[section]).flatMap((v, index) => {
    const p = obj(v), refs = list(p.evidence_ids).filter((x): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x));
    return str(p.text) && str(p.category) && refs.length && refs.length === list(p.evidence_ids).length
      ? [{report_id: row.report_id, section, index, category: String(p.category), text: String(p.text), evidence_ids: refs}] : [];
  });
}
/** Deliberately small, conservative literal vocabulary. Never inferred from a score.
 * A match describes a reported observation, not a guaranteed facility or service. */
const featurePhrases: Record<string, string[]> = {
  quiet: ['quiet', 'calm atmosphere', 'calme', 'yen tinh'],
  fast_service: ['fast service', 'quick service', 'service rapide', 'phuc vu nhanh', 'nhanh nhen'],
  sea_view: ['sea view', 'ocean view', 'vue sur la mer', 'vue mer', 'canh bien', 'view bien'],
  air_conditioning: ['air conditioning', 'air conditioned', 'climatisation', 'climatise', 'may lanh', 'dieu hoa'],
  private_room: ['private room', 'salle privee', 'phong rieng'],
};
const contraryPhrases: Record<string, string[]> = {
  quiet: ['noisy', 'loud music', 'bruyant', 'bruyante', 'tieng on', 'on ao', 'nhac to'],
  fast_service: ['slow service', 'long wait', 'service lent', 'attente longue', 'cho mon lau', 'cho lau', 'phuc vu cham'],
};
function containsPhrase(text: string, phrases: string[]) {
  const k = ' ' + key(text).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g,' ') + ' ';
  return phrases.some(p => k.includes(' ' + p + ' '));
}
function hasPhrase(text: string, feature: string) {
  return containsPhrase(text,Object.hasOwn(featurePhrases,feature) ? featurePhrases[feature] : []);
}
function affirmative(text: string) {
  const k = key(text).replace(/khong (gian|khi)/g, '');
  return !/\b(not|no|never|without|pas|sans|non|jamais|khong|chua|thieu)\b/.test(k);
}
function featureStatus(name: string, positives: Citation[], negatives: Citation[]): Proposal['features'][string] {
  const contrary = (p: Citation) => containsPhrase(p.text,Object.hasOwn(contraryPhrases,name) ? contraryPhrases[name] : []);
  const yes = positives.filter(p => hasPhrase(p.text, name) && affirmative(p.text) && !contrary(p));
  const no = [...negatives.filter(p => hasPhrase(p.text, name) || contrary(p)), ...positives.filter(p => hasPhrase(p.text, name) && (!affirmative(p.text) || contrary(p)))];
  return {status: yes.length ? no.length ? 'conflicted' : 'reported' : no.length ? 'conflicted' : 'not_documented', citations: [...yes, ...no]};
}
function combinedFeature(name:string,profile:PlaceProfile|null,positives:Citation[],negatives:Citation[],language:string):Proposal['features'][string]{
 const report=featureStatus(name,positives,negatives),fact=profile&&Object.hasOwn(profile.attributes.facts,name)?profile.attributes.facts[name]:undefined;
 const google=fact?{...fact,source:profile!.attributes.source,observed_at:profile!.attributes.observed_at}:undefined;
 const status=fact?.status==='conflicted'||fact?.value===true&&report.status==='conflicted'||fact?.value===false&&report.status==='reported'?'conflicted'
  :fact?.value===false?'denied':fact?.value===true?'reported':report.status;
 return {status,citations:report.citations,label:placeFeatureLabel(name,language),...(google?{google}:{})};
}
function priceRange(raw: unknown): Prices['establishment']['range'] {
  const r=googleMoneyRange(raw);
  return r.status==='parsed'&&r.bounds==='closed'&&r.currency!==null&&r.minimum!==null&&r.maximum!==null
    ?{currency:r.currency,minimum:r.minimum,maximum:r.maximum}:null;
}
function confirmedPriceUnit(e:Obj,range:Prices['establishment']['range']):'per_person'|null {
  if (!range || e.unit != null && e.unit !== 'per_person') return null;
  const samePrice = (label:unknown) => {
    if (!googlePerPersonPriceLabel(label)) return false;
    const r=googleMoneyRange(label);
    return r.bounds==='closed' && r.currency===range.currency && r.minimum===range.minimum && r.maximum===range.maximum;
  };
  if ([e.price,e.price_range].some(samePrice)) return 'per_person';
  // A saved Google Maps observation must quote this price and identify this establishment.
  const proof=obj(e.unit_evidence);
  if (proof.source!=='google_maps_ui' || !samePrice(proof.label) || typeof proof.observed_at!=='string'
    || !Number.isFinite(Date.parse(proof.observed_at)) || typeof proof.url!=='string') return null;
  try {
    const url=new URL(proof.url);
    if (url.protocol!=='https:' || !['www.google.com','maps.google.com'].includes(url.hostname)
      || url.username || url.password || url.port || !/^\/maps(?:\/|$)/.test(url.pathname)) return null;
    const cid=typeof e.google_id==='string' && /^\d+$/.test(e.google_id) ? e.google_id : null;
    const placeId=typeof e.place_id==='string' && e.place_id ? e.place_id : null;
    const savedCid=url.searchParams.get('cid'),savedPlaceId=url.searchParams.get('query_place_id');
    if (savedCid!==null && savedCid!==cid || savedPlaceId!==null && savedPlaceId!==placeId) return null;
    return savedCid!==null || savedPlaceId!==null ? 'per_person' : null;
  } catch {return null;}
}
export function prices(metadata: Obj,language='fr'): Prices {
  const b = obj(metadata.budget), e = obj(b.establishment_price), c = obj(b.customer_spend_per_person);
  const trustworthy = ['google_maps_import','google_maps_place_details'].includes(String(e.source)) && e.status === 'provided' && typeof e.observed_at === 'string' && Number.isFinite(Date.parse(e.observed_at));
  const level = trustworthy ? googlePriceLevel(e.price_level) ?? googlePriceLevel(e.price,false) : null;
  const range = trustworthy ? priceRange(e.price_range) ?? priceRange(e.price) : null;
  const unit = trustworthy ? confirmedPriceUnit(e,range) : null;
  return {establishment:{status:level !== null || range !== null ? 'known' : 'unknown',level,range,source:str(e.source),observed_at:str(e.observed_at),raw:{price:e.price ?? null,price_level:e.price_level ?? null,price_range:e.price_range ?? null},
    source_fields:list(e.source_fields).filter((x):x is string=>typeof x==='string'),source_table:str(e.source_table),provider_scraped_at:str(e.provider_scraped_at),missing_reason:str(e.missing_reason),
    label:level!==null||range!==null ? str(e.price)??str(e.price_range)??str(e.price_level)??String(level) : language==='vi'?'Chưa có thông tin giá':'Prix non renseigné',
    unit,unit_status:unit?'confirmed':'unknown',unit_label:unit ? language==='vi'?'Mỗi người':'Par personne' : language==='vi'?'Chưa rõ đơn vị':'Unité inconnue',indicative:true,guaranteed_tariff:false},
    customer_spend_per_person:{source:str(c.source),status:str(c.status),observed_at:str(c.observed_at),guaranteed_tariff:false,ranges:list(c.ranges).flatMap(x => {
      const v = obj(x);return typeof v.value === 'string' && Number.isInteger(v.review_count) && Number(v.review_count) > 0 ? [{value:v.value,review_count:Number(v.review_count),parsed:googleMoneyRange(v.value),source_fields:list(v.source_fields).filter((x):x is string=>typeof x==='string'),period_start:str(v.period_start),period_end:str(v.period_end)}] : [];
    })}};
}
function budgetMatch(p: Prices, b?: Budget): Proposal['budget_match'] | null {
  if (!b) return 'not_requested';
  if (b.kind === 'price_level') return p.establishment.level !== null && b.allowed.includes(p.establishment.level) ? 'google_level' : null;
  const r = p.establishment.range;
  return p.establishment.unit==='per_person' && r && r.currency === b.currency && r.maximum <= b.maximum && r.minimum >= (b.minimum ?? 0) ? 'google_range' : null;
}
function validPublication(row: SheetRow) {
  const p = row.publication;
  if (!p || p.report_id !== row.report_id || p.source_run_id !== row.source_run_id || p.establishment_id !== row.establishment_id || p.organization_id !== row.organization_id
    || p.language !== row.language || Date.parse(p.generated_at) !== Date.parse(row.report_generated_at) || !Number.isFinite(Date.parse(p.generated_at))
    || p.scope.fingerprint !== row.corpus.fingerprint || !row.corpus.fingerprint || row.report_sections.report_id !== row.report_id
    || p.derived.format_version !== 'jls-direct-categories4-report-v1' || !/^[a-f0-9]{64}$/.test(String(p.derived.statistics_sha256))) return false;
  const report = obj(p.derived.report);
  return Array.isArray(report.positive_aspects) && Array.isArray(report.negative_aspects)
    && canonical(report.positive_aspects) === canonical(row.report_sections.positive_aspects)
    && canonical(report.negative_aspects) === canonical(row.report_sections.reservations);
}
const cmpId = (a: Candidate, b: Candidate) => a.proposal.establishment_id < b.proposal.establishment_id ? -1 : a.proposal.establishment_id > b.proposal.establishment_id ? 1 : 0;
// A neutral tie-break value is internal only; an absent user position is never returned as zero metres.
const rankDistance = (c:Candidate) => c.proposal.distance_metres ?? 0;
export function recommendationCuisineOptions(rows:SheetRow[],organization:string,language:string):string[] {
  return [...new Set(rows.flatMap(row=>recommendRestaurants([row],organization,language,{geography:'not_requested'}).proposals.flatMap(p=>p.cuisines.values)))].sort();
}
function bands<T>(items: T[], get: (v: T) => Rational): T[][] {
  const sorted = [...items].sort((a,b) => -compare(get(a),get(b))), result: T[][] = [];
  for (const v of sorted) {
    const last = result.at(-1);
    if (!last || compare(subtract(get(last[0]),get(v)),rational(COMPARABLE_SCORE_GAP)) > 0) result.push([v]);
    else last.push(v);
  }
  return result;
}
function comparableBudgets(a: Prices, b: Prices) {
  return a.establishment.level !== null && b.establishment.level !== null || !!(a.establishment.range && b.establishment.range && a.establishment.range.currency === b.establishment.range.currency);
}
function distinctBudgets(a: Prices, b: Prices) {
  if (a.establishment.level !== null && b.establishment.level !== null) return a.establishment.level !== b.establishment.level;
  const x = a.establishment.range, y = b.establishment.range;
  return !!(x && y && x.currency === y.currency && (x.maximum < y.minimum || y.maximum < x.minimum));
}
/** PURE internal domain function. Its inputs must be the RLS-authorized catalogue.
 * No storage mutation, supplier, LLM, geocoder, public handler or HOME AI call. */
export function recommendRestaurants(rows: SheetRow[], organization: string, language: string, request: Request): Result {
  validateRequest(request);
  if (!organization || !['fr','vi'].includes(language)) throw Error('AUTHORIZED_CONTEXT_REQUIRED');
  const result: Result = {version:RECOMMENDATION_ENGINE_VERSION,comparable_score_gap:COMPARABLE_SCORE_GAP,proposals:[],excluded:[],notices:[],refinements:[]};
  const features = [...new Set([...(request.preferences?.features ?? []),...(request.required_features ?? [])])];
  const preferredCategories = [...new Set(request.preferences?.categories ?? [])];
  const unknownFeatures = features.filter(f => !Object.hasOwn(featurePhrases,f)&&!Object.hasOwn(PLACE_FEATURES,f));
  result.notices.push(...unknownFeatures.map(f => 'UNSUPPORTED_FEATURE:' + f));
  const authorised = rows.filter(r => r.organization_id === organization && r.language === language);
  const seen = new Set<string>(), duplicates = new Set<string>();
  for (const r of authorised) {if (seen.has(r.establishment_id)) duplicates.add(r.establishment_id);seen.add(r.establishment_id);}
  const candidates: Candidate[] = [];
  for (const row of authorised) {
    const reasons: string[] = [], identity = obj(row.metadata.identity), google = obj(row.metadata.google_metadata);
    const name = str(identity.name) ?? row.establishment_id;
    if (!validPublication(row) || identity.establishment_id !== row.establishment_id || identity.organization_id !== organization) reasons.push('INVALID_OR_MISMATCHED_REPORT');
    if (duplicates.has(row.establishment_id)) reasons.push('DUPLICATE_SHEET');
    const corpusChanged=!!(row.stale||row.publication?.stale)&&(!row.stale||row.stale_reason==='CORPUS_CHANGED')&&(!row.publication?.stale||(row.publication.stale_reason??row.stale_reason)==='CORPUS_CHANGED');
    if ((row.stale || row.publication?.stale)&&!corpusChanged) reasons.push('STALE_SHEET');
    if (row.calculation_version !== 'internal-recommendation-v2') reasons.push('UNSUPPORTED_SCORE_VERSION');
    const profile=practicalProfile(row);
    if(profile?.hours.permanently_closed===true||profile?.hours.temporarily_closed===true)reasons.push('GOOGLE_CLOSURE_OBSERVED');
    const opening=request.visit_at&&profile?scheduledOpening(profile,request.visit_at,request.hours_kind):null;
    if(request.visit_at&&opening!=='scheduled_open')reasons.push(opening==='scheduled_closed'?'OUTSIDE_DOCUMENTED_HOURS':'HOURS_NOT_VERIFIABLE');
    const point = obj(profile?.identity.coordinates??google.coordinates) as Point;
    const distance = request.geography==='not_requested' ? null : validPoint(point) ? distanceMetres(request.origin,point) : null;
    if(request.geography!=='not_requested') {
      if (distance === null) reasons.push('MISSING_COORDINATES');
      else if (!inArea(point,distance,request.area)) reasons.push('OUTSIDE_AREA');
    }
    const types=documentedTaxonomy(google,profile,'cuisines'),specialties=documentedTaxonomy(google,profile,'specialties'),usages=documentedTaxonomy(google,profile,'usages');
    for(const [kind,values]of [['specialties',specialties],['usages',usages]] as const)if(request[kind]?.length&&!request[kind]!.some(c=>values.includes(taxonomyValue(kind,c)??key(c))))reasons.push(kind.toUpperCase()+'_NOT_CONFIRMED');
    if (request.cuisines?.length && !request.cuisines.some(c => types.includes(cuisine(c)))) reasons.push(types.length ? 'CUISINE_MISMATCH' : 'CUISINE_NOT_DOCUMENTED');
    const budget = prices(row.metadata,language), match = budgetMatch(budget,request.budget);
    if (match === null) reasons.push(budget.establishment.status === 'unknown' ? 'BUDGET_UNKNOWN'
      : request.budget?.kind==='amount' && budget.establishment.unit!=='per_person' ? 'BUDGET_UNIT_UNCONFIRMED' : 'BUDGET_NOT_COMPARABLE_OR_MISMATCH');
    const positives = citations(row,'positive_aspects'), reservations = citations(row,'reservations');
    const observations=Object.fromEntries(features.map(f=>[f,combinedFeature(f,profile,positives,reservations,language)]));
    const contradictions=Object.keys(featurePhrases).map(f=>({feature:f,...combinedFeature(f,profile,positives,reservations,language)})).filter(x=>x.status==='conflicted'&&x.google&&x.citations.length).map(x=>({feature:x.feature,google:x.google,citations:x.citations}));
    if (request.required_features?.some(f => observations[f].status !== 'reported')) reasons.push('REQUIRED_FEATURE_NOT_CONFIRMED');
    let global: ReturnType<typeof score> | null = null, categories: Record<Category, ReturnType<typeof score>> | null = null;
    try {
      const calc = obj(exactJson(row.calculation_text));
      if (calc.version !== 'internal-recommendation-v2' || calc.positive_weight !== '1' || calc.negative_weight !== '-4' || calc.status !== 'ready' || calc.comparable !== true || !Number.isInteger(Number(calc.total_reviews))
        || Number(calc.total_reviews) <= 0 || Number(calc.total_reviews) > 150 || Number(calc.total_reviews) !== Number(row.corpus.total_reviews)
        || Number(calc.total_reviews) !== Number(row.publication?.scope.review_count)) throw Error('MISSING_SCORES');
      global = score(calc,'global_score');
      categories = Object.fromEntries(CATEGORIES.map(c => [c,score(obj(obj(calc.categories)[c]))])) as Record<Category, ReturnType<typeof score>>;
      const sum = CATEGORIES.reduce((s,c) => add(s,categories![c].exact),rational('0'));
      if (compare({n:sum.n,d:sum.d * 3n},global.exact)) throw Error('INCONSISTENT_GLOBAL');
    } catch {reasons.push('MISSING_OR_INCONSISTENT_SCORES');}
    if (reasons.length || !global || !categories || distance === null && request.geography!=='not_requested' || match === null) {
      result.excluded.push({establishment_id:row.establishment_id,name,report_id:row.report_id,reasons});continue;
    }
    const choiceReasons: Proposal['reasons'] = [{code:'INTERNAL_V2_GLOBAL'},{code:request.geography==='not_requested'?'ACCESSIBLE_CATALOGUE':'WITHIN_REQUESTED_AREA'}];
    if (request.cuisines?.length) choiceReasons.push({code:'DOCUMENTED_CUISINE_MATCH'});
    for (const c of preferredCategories) choiceReasons.push({code:'CATEGORY_PREFERENCE',category:c,citations:positives.filter(p => p.category === c)});
    for (const f of features) if (observations[f].status === 'reported') choiceReasons.push({code:observations[f].google?'GOOGLE_DECLARED_FEATURE':'REPORTED_FEATURE',feature:f,citations:observations[f].citations});
    if (!preferredCategories.length) choiceReasons.push(...positives.filter(p => CATEGORIES.includes(p.category as Category)).map(p => ({code:'REPORT_STRENGTH',citations:[p]})));
    const catsWithEvidence = preferredCategories.filter(c => positives.some(p => p.category === c));
    const sum = catsWithEvidence.reduce((s,c) => add(s,categories![c].exact),rational('0'));
    const preference = catsWithEvidence.length ? {n:sum.n,d:sum.d * BigInt(catsWithEvidence.length)} : rational('0');
    const proposal: Proposal = {establishment_id:row.establishment_id,name,distance_metres:distance,distance_kind:request.geography==='not_requested'?'not_requested':'straight_line',cuisines:{values:types,source:profile?.categories.source??str(google.source),observed_at:profile?.categories.observed_at??str(google.observed_at)},
      practical:profile,specialties,usages,contradictions,opening:{status:request.visit_at?'scheduled_open':'not_requested',live:false,holiday_guarantee:false},
      scores:{quality:categories.quality.out,service:categories.service.out,ambiance:categories.ambiance.out,global:global.out},budget,budget_match:match,
      reasons:choiceReasons,reservations,features:observations,report:{id:row.report_id,generated_at:row.report_generated_at,language:row.language,freshness:corpusChanged?'corpus_changed':'current',corpus:row.corpus}};
    if(corpusChanged)proposal.reasons.push({code:'DATED_REPORT_NEW_REVIEWS_NOT_COVERED'});
    candidates.push({proposal,global:global.exact,preference,matches:features.filter(f => observations[f].status === 'reported').length,band:0,preference_band:0});
  }
  const ranked: Candidate[] = [];
  bands(candidates,c => c.global).forEach((group,band) => {
    const matchCounts = [...new Set(group.map(c => c.matches))].sort((a,b) => b-a);
    for (const matches of matchCounts) bands(group.filter(c => c.matches === matches),c => c.preference).forEach((pg,preference_band) => {
      pg.forEach(c => {c.band=band;c.preference_band=preference_band;});
      ranked.push(...pg.sort((a,b) => rankDistance(a)-rankDistance(b) || cmpId(a,b)));
    });
  });
  const remaining = [...ranked], chosen: Candidate[] = [];
  while (remaining.length && chosen.length < 3) {
    const first = remaining[0];
    const comparable = remaining.filter(c => c.band === first.band && c.matches === first.matches && c.preference_band === first.preference_band
      && rankDistance(c) <= rankDistance(first) + COMPARABLE_DISTANCE_METRES);
    const represented = (c: Candidate) => chosen.some(x => comparableBudgets(c.proposal.budget,x.proposal.budget) && !distinctBudgets(c.proposal.budget,x.proposal.budget));
    const varied = comparable.find(c => chosen.some(x => comparableBudgets(c.proposal.budget,x.proposal.budget)) && !represented(c));
    // Diversify only after the first choice; never prefer a known price merely because another is unknown.
    const pick = represented(first) ? varied ?? first : first;
    remaining.splice(remaining.indexOf(pick),1);chosen.push(pick);
  }
  result.proposals = chosen.map(c => c.proposal);
  if (result.proposals.some(p => p.budget.establishment.status === 'unknown')) result.notices.push('ESTABLISHMENT_BUDGET_UNKNOWN');
  if (!result.proposals.length) result.notices.push('NO_MATCHING_CURRENT_SHEET');
  for (const from of chosen) for (const alt of candidates) {
    if (chosen.includes(alt) || compare(subtract(from.global,alt.global),rational(COMPARABLE_SCORE_GAP)) > 0 || alt.matches < from.matches
      || compare(subtract(from.preference,alt.preference),rational(COMPARABLE_SCORE_GAP)) > 0) continue;
    const base = {from_id:from.proposal.establishment_id,alternative_id:alt.proposal.establishment_id};
    for(const feature of features)if(alt.proposal.features[feature]?.status==='reported'&&from.proposal.features[feature]?.status!=='reported')result.refinements.push({kind:'documented_feature',feature,...base});
    if (alt.proposal.distance_metres!==null && from.proposal.distance_metres!==null && alt.proposal.distance_metres < from.proposal.distance_metres) result.refinements.push({kind:'closer',...base});
    const a = from.proposal.budget.establishment, b = alt.proposal.budget.establishment;
    if (rankDistance(alt) > rankDistance(from) + COMPARABLE_DISTANCE_METRES) continue;
    if (a.level !== null && b.level !== null && b.level < a.level) result.refinements.push({kind:'lower_price_level',...base});
    if (a.range && b.range && a.range.currency === b.range.currency && b.range.maximum < a.range.minimum) result.refinements.push({kind:'lower_price_range',...base});
  }
  result.excluded.sort((a,b) => a.establishment_id < b.establishment_id ? -1 : a.establishment_id > b.establishment_id ? 1 : 0);
  return result;
}
