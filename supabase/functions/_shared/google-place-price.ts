import {googleMoneyRange} from './google-maps-prices.ts';

export const PLACE_PRICE_ACTOR = 'compass~crawler-google-places';
export const PLACE_PRICE_BUILD = '0.14.777';
export const PLACE_PRICE_ACTOR_ID = 'nwua9Gu5YrADL7ZDj';
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
const receiptFields=['id','actId','buildId','startedAt','finishedAt','status','defaultDatasetId','usage','usageTotalUsd','chargedEventCounts'] as const;
export function priceRun(payload:unknown):PriceRun {
  const data=record(record(payload).data),id=text(data.id),dataset_id=text(data.defaultDatasetId),status=text(data.status);
  if(!id || !dataset_id || !status || data.actId!==PLACE_PRICE_ACTOR_ID)throw Error('PLACE_PRICE_RUN_INVALID');
  return {id,dataset_id,status,receipt:Object.fromEntries(receiptFields.filter(k=>data[k]!==undefined).map(k=>[k,data[k]]))};
}

/** No SDK retries, redirect or implicit restart. The secret stays in server memory/headers. */
export function placePriceProvider(token:string,network:typeof fetch=fetch) {
  if(!token.trim())throw Error('PLACE_PRICE_ACCESS_UNAVAILABLE');
  async function get(path:string,init:RequestInit={},timeout=30_000):Promise<unknown> {
    const response=await network('https://api.apify.com/v2'+path,{...init,redirect:'error',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(timeout)});
    if(!response.ok)throw Error('PLACE_PRICE_HTTP_'+response.status);
    return response.json();
  }
  return {
    start:async(input:ReturnType<typeof placePriceInput>)=>priceRun(await get('/acts/'+PLACE_PRICE_ACTOR+'/runs?build='+PLACE_PRICE_BUILD+'&timeout=120&maxTotalChargeUsd=0.10', {method:'POST',body:JSON.stringify(input)})),
    run:async(id:string)=>priceRun(await get('/actor-runs/'+encodeURIComponent(id)+'?waitForFinish=20')),
    dataset:async(id:string)=>get('/datasets/'+encodeURIComponent(id)+'/items?clean=true&format=json&limit=2'),
  };
}

export type PriceJob = PriceIdentity & {id:string;run_id:string|null;dataset_id:string|null;start_attempted_at:string|null;request_input:unknown};
export interface PricePort {
  action(action:string,data?:Obj):Promise<boolean>;
  provider:ReturnType<typeof placePriceProvider>;
}
export async function processPlacePrice(job:PriceJob,port:PricePort) {
  const action=async(name:string,data:Obj={})=>{if(!await port.action(name,data))throw Error('PLACE_PRICE_LEASE_LOST');};
  let reserved=job.start_attempted_at!==null,runId=job.run_id,datasetId=job.dataset_id;
  try {
    const input=placePriceInput(job);
    if(!runId) {
      if(reserved)throw Error('PLACE_PRICE_OUTCOME_UNKNOWN');
      await action('reserve',{input});reserved=true;
      const run=await port.provider.start(input);
      await action('run',run);runId=run.id;datasetId=run.dataset_id;
    }
    for(let n=0;n<2;n++) {
      const run=await port.provider.run(runId);
      if(run.id!==runId || datasetId && run.dataset_id!==datasetId)throw Error('PLACE_PRICE_RUN_IDENTITY_MISMATCH');
      await action('run',run);datasetId=run.dataset_id;
      if(['FAILED','TIMED-OUT','ABORTED'].includes(run.status)) {await action('fail',{code:'PLACE_PRICE_PROVIDER_'+run.status});return 'failed';}
      if(run.status==='SUCCEEDED') {
        const observation=placePriceObservation(await port.provider.dataset(datasetId),job);
        await action('finish',{observation,receipt:run.receipt});return 'finished';
      }
    }
    await action('defer');return 'pending';
  } catch(error) {
    const reason=error instanceof Error ? error.message : 'PLACE_PRICE_FAILED';
    if(reason==='PLACE_PRICE_LEASE_LOST')return 'lease_lost';
    // A response lost before its durable run binding consumes the attempt forever.
    const code=reserved && !runId ? 'PLACE_PRICE_OUTCOME_UNKNOWN' : /^PLACE_PRICE_[A-Z0-9_-]+$/.test(reason) ? reason : 'PLACE_PRICE_READ_FAILED';
    await port.action('fail',{code});return code;
  }
}
