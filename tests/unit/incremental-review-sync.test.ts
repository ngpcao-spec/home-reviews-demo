// @vitest-environment node
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {incrementalSince,prepareIncrementalResult,assertIncrementalReceipt,INCREMENTAL_ACTOR_BUILD} from '../../supabase/functions/_shared/incremental-review-sync';
import {apifyActorInput,startApifyRun} from '../../supabase/functions/_shared/apify';
const now=Date.parse('2026-10-29T06:00:00Z'),at='2026-10-28T12:00:00Z';
const cp={google_id:'123',google_maps_url:'https://www.google.com/maps?cid=123',checkpoint_review_id:'known',checkpoint_review_at:at};
const run={runId:'run',datasetId:'data',status:'SUCCEEDED'};
const item=(id:string,date=at)=>({cid:'123',reviewId:id,stars:5,text:'Original',originalLanguage:'en',textTranslated:'Bản dịch',translatedLanguage:'vi',publishedAtDate:date,language:'vi'});
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN')}));});afterEach(()=>vi.unstubAllGlobals());
it('keeps the manual newest-150 input without date; automatically passes a UTC checkpoint minus five seconds',()=>{
 const manual=apifyActorInput({placeUrl:cp.google_maps_url,language:'vi',sort:'newest',limit:150});expect(manual.maxReviews).toBe(150);expect(manual).not.toHaveProperty('reviewsStartDate');
 const since=incrementalSince({...cp,checkpoint_review_at:'2026-10-28T19:00:00+07:00'},now);
 expect(since).toBe('2026-10-28T11:59:55.000Z');expect(apifyActorInput({placeUrl:cp.google_maps_url,language:'fr',sort:'newest',limit:150,since})).toMatchObject({reviewsStartDate:since,reviewsSort:'newest',language:'fr'});
});
it('blocks missing, invalid or future checkpoints instead of falling back to a full/30-day import',()=>{
 for(const date of [null,'bad','2026-10-28','2099-01-01T00:00:00Z'])expect(()=>incrementalSince({...cp,checkpoint_review_at:date},now)).toThrow(/SYNC_INCREMENTAL_CHECKPOINT/);
 expect(()=>incrementalSince({...cp,checkpoint_review_id:null},now)).toThrow('SYNC_INCREMENTAL_CHECKPOINT_MISSING');
});
it('does not stop at a known ID and keeps unknown reviews at the same timestamp or inside the overlap',()=>{
 const result=prepareIncrementalResult([item('known'),item('same-time'),item('late','2026-10-28T11:59:57Z'),item('same-time')],cp,run,false,now);
 expect(result.reviews.map(r=>r.externalReviewId)).toEqual(['known','same-time','late']);expect(result).toMatchObject({received:4,unique:3,outside_window:0,head:{id:'known',at}});
});
it('three new reviews plus the overlap are not a 3/150 failure; zero results keep the review watermark',()=>{
 const p=prepareIncrementalResult([item('a','2026-10-28T13:00:00Z'),item('b','2026-10-28T12:30:00Z'),item('c','2026-10-28T12:05:00Z'),item('known')],cp,run,false,now);
 expect(p).toMatchObject({received:4,unique:4,head:{id:'a',at:'2026-10-28T13:00:00Z'}});
 expect(prepareIncrementalResult([],cp,run,false,now)).toMatchObject({empty:true,head:{id:'known',at},received:0});
});
it('separately blocks cap, unresolved coverage, invalid IDs/dates, conflicting duplicates and native stop signals',()=>{
 expect(()=>prepareIncrementalResult(Array.from({length:150},(_,i)=>item('r'+i)),cp,run,false,now)).toThrow('SYNC_INCREMENTAL_LIMIT_REACHED');
 expect(()=>prepareIncrementalResult([item('new','2026-10-28T13:00:00Z')],cp,run,false,now)).toThrow('SYNC_INCREMENTAL_BOUNDARY_NOT_REACHED');
 for(const bad of [{...item('x'),cid:'456'},{...item('x'),publishedAtDate:null},{...item('x'),stars:0}])expect(()=>prepareIncrementalResult([item('known'),bad],cp,run,false,now)).toThrow(/SYNC_INCREMENTAL/);
 expect(()=>prepareIncrementalResult([item('known'),{...item('known'),text:'Changed'}],cp,run,false,now)).toThrow('SYNC_INCREMENTAL_CONFLICTING_DUPLICATE');
 for(const receipt of [{isMaxTotalChargeUsdReached:true},{isMaxItemsReached:true},{statusMessage:'Finished! Total 2 requests: 1 succeeded, 1 failed.'}])expect(()=>assertIncrementalReceipt(receipt)).toThrow('SYNC_INCREMENTAL_PROVIDER_PARTIAL');
 expect(()=>assertIncrementalReceipt({statusMessage:'Finished! Total 1 requests: 1 succeeded, 0 failed.'})).not.toThrow();
});
it('can reuse an already paid legacy window when its older rows prove the date boundary was crossed',()=>{
 const rows=[item('new','2026-10-28T13:00:00Z'),item('known'),...Array.from({length:148},(_,i)=>item('old-'+i,'2026-10-20T00:00:00Z'))];
 const result=prepareIncrementalResult(rows,cp,run,true,now);expect(result).toMatchObject({received:150,unique:150,outside_window:148,legacy:true});expect(result.reviews).toHaveLength(2);
});
it('pins the verified automatic build and durably reserves the exact input before its single HTTP start',async()=>{
 vi.stubGlobal('Deno',{env:{get:()=>undefined}});
 const network=vi.fn(async()=>new Response(JSON.stringify({data:{id:'run',defaultDatasetId:'data',status:'RUNNING'}})));
 vi.stubGlobal('fetch',network);const reserve=vi.fn(async(input)=>{expect(input.reviewsStartDate).toBe('2026-10-28T11:59:55.000Z');expect(network).not.toHaveBeenCalled();});
 await startApifyRun('SYNTHETIC',{placeUrl:cp.google_maps_url,language:'vi',sort:'newest',limit:150,since:incrementalSince(cp,now),build:INCREMENTAL_ACTOR_BUILD},undefined,reserve);
 expect(network).toHaveBeenCalledTimes(1);expect(network.mock.calls[0][0]).toContain('&build=0.0.541');expect(reserve).toHaveBeenCalledTimes(1);
});
