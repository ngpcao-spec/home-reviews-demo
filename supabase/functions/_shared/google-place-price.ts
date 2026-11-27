import {googleMoneyRange} from './google-maps-prices.ts';
import {placeProfile} from './google-place-profile.ts';

export const PLACE_PRICE_ACTOR = 'compass~crawler-google-places';
export const PLACE_PRICE_ACTOR_ID = 'nwua9Gu5YrADL7ZDj';
// Actor metadata minimalMaxTotalChargeUsd, verified before every new paid start.
// This is a ceiling, not a fee or an estimate of the one-place run's cost.
export const PLACE_PRICE_MAX_CHARGE_USD = 0.5;
export type PriceIdentity = {google_id:string; place_id:string|null; google_maps_url:string; language:'fr'|'vi'};
type Obj = Record<string,unknown>;
const record = (x:unknown):Obj => x!==null && typeof x==='object' && !Array.isArray(x) ? x as Obj : {};
const text = (x:unknown) => typeof x==='string' && x.trim() ? x.trim() : null;

/** Only an already verified Google place; never a search, shortened URL or arbitrary host. */
export function placePriceInput(identity:PriceIdentity) {
  if(!/^\d+$/.test(identity.google_id) || !['fr','vi'].includes(identity.language)) throw Error('PLACE_PRICE_IDENTITY_INVALID');
  const url=new URL(identity.google_maps_url);
  if(!['www.google.com','google.com','maps.google.com'].includes(url.hostname) || url.protocol!=='https:' || url.port || url.username || url.password || !url.pathname.startsWith('/maps')) throw Error('PLACE_PRICE_URL_INVALID');
  const cid=url.searchParams.get('cid'),place=url.searchParams.get('query_place_id');
  const fid=/0x[0-9a-f]+:0x([0-9a-f]+)/i.exec(decodeURIComponent(url.pathname));
  if(cid && cid!==identity.google_id || place && place!==identity.place_id || fid && BigInt('0x'+fid[1]).toString()!==identity.google_id) throw Error('PLACE_PRICE_URL_IDENTITY_MISMATCH');
  if(!cid && !place && !fid) throw Error('PLACE_PRICE_URL_UNVERIFIED');
  return {startUrls:[{url:identity.google_maps_url}],maxCrawledPlacesPerSearch:1,language:identity.language,
    scrapePlaceDetailPage:true,maxReviews:0,maxImages:0,scrapeReviewsPersonalData:false,scrapeImageAuthors:false,
    scrapeContacts:false,maximumLeadsEnrichmentRecords:0,enableCompetitorAnalysis:false,scrapeDirectories:false,
    scrapeTableReservationProvider:false,scrapeOrderOnline:false,includeWebResults:false};
}

/** A small allowlist, never a copy of reviews, customer posts, photos or place prose. */
export function placePriceObservation(items:unknown,identity:PriceIdentity,now=Date.now()) {
  if(!Array.isArray(items) || items.length!==1) throw Error('PLACE_PRICE_OUTPUT_COUNT_INVALID');
  const item=record(items[0]);
  if(text(item.cid)!==identity.google_id || identity.place_id && text(item.placeId)!==identity.place_id) throw Error('PLACE_PRICE_IDENTITY_MISMATCH');
  if(item.language!==identity.language) throw Error('PLACE_PRICE_LANGUAGE_MISMATCH');
  if(!Array.isArray(item.reviews) || item.reviews.length!==0) throw Error('PLACE_PRICE_UNEXPECTED_REVIEWS');
  const at=text(item.scrapedAt);
  if(!at || !Number.isFinite(Date.parse(at)) || Date.parse(at)>now+300_000) throw Error('PLACE_PRICE_OBSERVATION_DATE_INVALID');
  const price=text(item.price),range=googleMoneyRange(item.priceRange??price);
  const unit=price && /(?:per person|par personne|mỗi người|\/người)\s*$/iu.test(price) ? 'per_person' : null;
  const raw:Obj={cid:item.cid,placeId:item.placeId??null,scrapedAt:at,price};
  if(typeof item.priceLevel==='string' || typeof item.priceLevel==='number'&&Number.isFinite(item.priceLevel))raw.priceLevel=item.priceLevel;
  if(typeof item.priceRange==='string')raw.priceRange=item.priceRange;
  else if(item.priceRange && typeof item.priceRange==='object' && !Array.isArray(item.priceRange)) {
    raw.priceRange=Object.fromEntries(Object.entries(record(item.priceRange)).filter(([k,v])=>k==='currency'&&typeof v==='string'||['minimum','maximum'].includes(k)&&typeof v==='number'&&Number.isFinite(v)));
  }
  return {raw,language:identity.language,normalized_range:range,unit,
    unit_evidence:unit ? {source:'provider_price_label',label:price} : null,guaranteed_tariff:false};
}

export type PriceRun = {id:string;dataset_id:string;status:string;receipt:Obj};
type PricePreflight = {
  actor_id:string; build_number:string; build_id:string; minimum_max_total_charge_usd:number;
  max_total_charge_usd:number; checked_at:string;
};
const receiptFields=['id','actId','buildId','startedAt','finishedAt','status','defaultDatasetId','usage','usageTotalUsd','chargedEventCounts'] as const;
export function priceRun(payload:unknown):PriceRun {
  const data=record(record(payload).data),id=text(data.id),dataset_id=text(data.defaultDatasetId),status=text(data.status);
  if(!id || !dataset_id || !status || data.actId!==PLACE_PRICE_ACTOR_ID)throw Error('PLACE_PRICE_RUN_INVALID');
  return {id,dataset_id,status,receipt:Object.fromEntries(receiptFields.filter(k=>data[k]!==undefined).map(k=>[k,data[k]]))};
}

const rejectedStarts=new Set([
  'actor-disabled','actor-not-found','actor-not-public','actor-is-not-rented','apify-plan-required-to-use-paid-actor',
  'build-not-found','build-outdated','invalid-build','unknown-build-tag','tagged-build-required',
  'invalid-input','schema-validation-error','schema-validation-failed','invalid-parameter',
  'invalid-token','invalid-credentials','insufficient-permissions','missing-actor-rights',
  'not-enough-usage-to-run-paid-actor','monthly-usage-limit-too-low','max-total-charge-usd-below-minimum',
]);
class PlacePriceHttpError extends Error {
  constructor(readonly status:number,readonly providerType:string|null) {
    super('PLACE_PRICE_HTTP_'+status);
  }
  get confirmedRejection() {
    return [400,401,403,404,422].includes(this.status)&&!!this.providerType&&rejectedStarts.has(this.providerType);
  }
}

/** No SDK retries, redirect or implicit restart. The secret stays in server memory/headers. */
export function placePriceProvider(token:string,network:typeof fetch=fetch) {
  if(!token.trim())throw Error('PLACE_PRICE_ACCESS_UNAVAILABLE');
  let preflight:PricePreflight|null=null;
  async function get(path:string,init:RequestInit={},timeout=30_000):Promise<unknown> {
    const response=await network('https://api.apify.com/v2'+path,{...init,redirect:'error',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(timeout)});
    if(!response.ok) {
      const payload=record(await response.json().catch(()=>null));
      const type=text(record(payload.error).type);
      throw new PlacePriceHttpError(response.status,type&&/^[a-z][a-z0-9-]{0,79}$/.test(type)?type:null);
    }
    return response.json();
  }
  return {
    preflight:async()=>{
      preflight=null;
      const data=record(record(await get('/acts/'+PLACE_PRICE_ACTOR)).data);
      const entries=Array.isArray(data.pricingInfos)?data.pricingInfos.map(record).filter(p=>typeof p.startedAt==='string'&&Date.parse(p.startedAt)<=Date.now()).sort((a,b)=>Date.parse(String(b.startedAt))-Date.parse(String(a.startedAt))):[];
      const pricing=entries[0],minimum=pricing?.minimalMaxTotalChargeUsd;
      if(data.id!==PLACE_PRICE_ACTOR_ID || pricing?.pricingModel!=='PAY_PER_EVENT' ||
        typeof minimum!=='number' || !Number.isFinite(minimum) || minimum<0 || minimum>PLACE_PRICE_MAX_CHARGE_USD)
        throw Error('PLACE_PRICE_PREFLIGHT_CHARGE_LIMIT_INVALID');
      // Resolve the published build with a free read and pin its exact number for this attempt.
      const build=record(record(await get('/acts/'+PLACE_PRICE_ACTOR+'/builds/default')).data);
      const buildNumber=text(build.buildNumber),buildId=text(build.id);
      if(build.status!=='SUCCEEDED'||build.actId!==data.id||!buildNumber||!/^\d+[.]\d+[.]\d+$/.test(buildNumber)||
        !buildId||!/^[A-Za-z0-9]+$/.test(buildId)) throw Error('PLACE_PRICE_BUILD_UNAVAILABLE');
      preflight={actor_id:data.id,build_number:buildNumber,build_id:buildId,minimum_max_total_charge_usd:minimum,
        max_total_charge_usd:PLACE_PRICE_MAX_CHARGE_USD,checked_at:new Date().toISOString()};
      return preflight;
    },
    start:async(input:ReturnType<typeof placePriceInput>)=>{
      if(!preflight)throw Error('PLACE_PRICE_PREFLIGHT_REQUIRED');
      const run=priceRun(await get('/acts/'+PLACE_PRICE_ACTOR+'/runs?build='+encodeURIComponent(preflight.build_number)+
        '&timeout=120&maxTotalChargeUsd='+PLACE_PRICE_MAX_CHARGE_USD, {method:'POST',body:JSON.stringify(input)}));
      run.receipt={...run.receipt,preflight};return run;
    },
    run:async(id:string)=>priceRun(await get('/actor-runs/'+encodeURIComponent(id)+'?waitForFinish=20')),
    dataset:async(id:string)=>get('/datasets/'+encodeURIComponent(id)+'/items?clean=true&format=json&limit=2'),
  };
}

export type PriceJob = PriceIdentity & {id:string;run_id:string|null;dataset_id:string|null;start_attempted_at:string|null;request_input:unknown;receipt?:Obj};
export interface PricePort {
  action(action:string,data?:Obj):Promise<boolean>;
  provider:ReturnType<typeof placePriceProvider>;
}
export async function processPlacePrice(job:PriceJob,port:PricePort) {
  const action=async(name:string,data:Obj={})=>{if(!await port.action(name,data))throw Error('PLACE_PRICE_LEASE_LOST');};
  let reserved=job.start_attempted_at!==null,runId=job.run_id,datasetId=job.dataset_id;
  let receipt=record(job.receipt);
  let pendingRun:PriceRun|null=null;
  try {
    const input=placePriceInput(job);
    if(!runId) {
      if(reserved)throw Error('PLACE_PRICE_OUTCOME_UNKNOWN');
      const preflight=await port.provider.preflight();
      await action('reserve',{input,preflight});reserved=true;
      const run=await port.provider.start(input);
      pendingRun=run;receipt=run.receipt;
      await action('run',run);runId=run.id;datasetId=run.dataset_id;
      if(run.receipt.buildId!==preflight.build_id)throw Error('PLACE_PRICE_RUN_BUILD_MISMATCH');
    }
    for(let n=0;n<2;n++) {
      const run=await port.provider.run(runId);
      if(run.id!==runId || datasetId && run.dataset_id!==datasetId)throw Error('PLACE_PRICE_RUN_IDENTITY_MISMATCH');
      const expectedBuild=text(record(receipt.preflight).build_id);
      if(expectedBuild&&run.receipt.buildId!==expectedBuild)throw Error('PLACE_PRICE_RUN_BUILD_MISMATCH');
      receipt={...receipt,...run.receipt};await action('run',{...run,receipt});datasetId=run.dataset_id;
      if(['FAILED','TIMED-OUT','ABORTED'].includes(run.status)) {await action('fail',{code:'PLACE_PRICE_PROVIDER_'+run.status});return 'failed';}
      if(run.status==='SUCCEEDED') {
        const items=await port.provider.dataset(datasetId),observation=placePriceObservation(items,job);
        await action('finish',{observation,profile:placeProfile(items,job),receipt});return 'finished';
      }
    }
    await action('defer');return 'pending';
  } catch(error) {
    const reason=error instanceof Error ? error.message : 'PLACE_PRICE_FAILED';
    if(reason==='PLACE_PRICE_LEASE_LOST') {
      if(pendingRun&&!runId) console.warn('PLACE_PRICE_RUN_BINDING_UNCONFIRMED',{job_id:job.id,run_id:pendingRun.id});
      return 'lease_lost';
    }
    const providerFailure=error instanceof PlacePriceHttpError
      ? {http_status:error.status,provider_type:error.providerType} : null;
    const unbound=reserved&&!runId;
    const rejected=unbound&&!pendingRun&&error instanceof PlacePriceHttpError&&error.confirmedRejection;
    const diagnostic=/^PLACE_PRICE_[A-Z0-9_-]+$/.test(reason)?reason:'PLACE_PRICE_NETWORK_OR_RUNTIME_ERROR';
    const code=rejected ? 'PLACE_PRICE_START_REJECTED' : unbound ? 'PLACE_PRICE_OUTCOME_UNKNOWN' :
      diagnostic==='PLACE_PRICE_NETWORK_OR_RUNTIME_ERROR' ? 'PLACE_PRICE_READ_FAILED' : diagnostic;
    console.warn('PLACE_PRICE_ATTEMPT_STOPPED',{job_id:job.id,code,diagnostic,...providerFailure,
      ...(pendingRun&&!runId ? {run_id:pendingRun.id}: {})});
    await port.action('fail',{code,...(providerFailure?{provider_failure:providerFailure}:{}),
      ...(pendingRun&&!runId?{unbound_run_id:pendingRun.id}:{})});
    return code;
  }
}
