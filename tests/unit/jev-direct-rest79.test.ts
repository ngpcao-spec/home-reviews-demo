import {it,expect,vi,beforeAll,afterAll} from 'vitest';
import {aggregateDirect80,rest79Scope,verifyRest79Consent,verifyDirectSaved,REST79_VERSION,REST79_PREFIX} from '../../supabase/functions/_shared/jev-direct-rest79';
import {rest79Port} from '../../supabase/functions/_shared/jev-direct-rest79-store';
import {DIRECT_PILOT_REVIEW,type PilotArchive} from '../../supabase/functions/_shared/jev-direct-pilot1';
import {prepareDirectCategories,type DirectCategoriesProtocol} from '../../supabase/functions/_shared/jev-direct-categories-preparation';
import {directHash,parseDirectCategories} from '../../supabase/functions/_shared/jev-direct-categories';
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text';
import {directSyntheticSource,directMockRaw} from '../fixtures/jev-direct-categories';
let blocked:ReturnType<typeof vi.spyOn>;
beforeAll(()=>{blocked=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('PROVIDER_NETWORK_FORBIDDEN'));});
afterAll(()=>{expect(blocked).not.toHaveBeenCalled();blocked.mockRestore();});
async function fixture(){const s=await directSyntheticSource();s.reviews[0].id=DIRECT_PILOT_REVIEW;s.reviews_sha256=await directHash(s.reviews);
 return await prepareDirectCategories(s,'a'.repeat(40));}
async function archive(kind:string,body:Record<string,unknown>):Promise<PilotArchive>{return {id:crypto.randomUUID(),kind,body,sha256:await directHash(body),protocol_id:'EXPLICIT_MOCK_PARENT',organization_id:'EXPLICIT_MOCK_ORG'};}
async function saved(p:DirectCategoriesProtocol,id:string,variant='normal'){
 const r=p.body.reviews.find(r=>r.review_id===id)!,raw=directMockRaw({service:'mixed',quality:'positive',ambiance:variant==='uncertain'?'uncertain':'neutral'}),
 text=variant==='network'?null:JSON.stringify(raw),base={review_id:id,configuration_sha256:p.body.configuration_sha256,analysis_text_sha256:r.analysis_text_sha256,
 request_sha256:r.request_sha256,request_raw_sha256:r.request_raw_sha256,request_count:1};
 const receipt=await archive('EXPLICIT_MOCK_RECEIPT',{...base,raw_response_text:text,response_raw_sha256:text===null?null:await analysisTextSha256(text),duration_ms:2});
 const result=await archive('EXPLICIT_MOCK_RESULT',{...base,receipt_id:receipt.id,status:variant==='network'?'failed_or_uncertain':'completed',
 result:variant==='network'?null:parseDirectCategories(raw),provider_retries:0,model_probe_calls:0,error:variant==='network'?'EXPLICIT_MOCK_NETWORK_LOSS':null});
 return {result,receipt};
}
it('binds exactly 79 pending review IDs, excluding the pilot, while leaving the 80-review configuration untouched',async()=>{
 const p=await fixture(),before=await directHash(p),scope=await rest79Scope(p);
 expect(scope.pending_review_ids).toHaveLength(79);expect(new Set(scope.pending_review_ids).size).toBe(79);expect(scope.pending_review_ids).not.toContain(DIRECT_PILOT_REVIEW);
 expect(scope).toMatchObject({max_new_jev_calls:79,max_questions:316,max_attempts_per_review:1,automatic_retry:false,model_probe_calls:0,luna_calls:0,sol_calls:0,apify_calls:0});
 expect(await directHash(p)).toBe(before);
});
it.each(['valid','expired','wider_scope','changed_directive','wrong_authority','missing_go','wrong_code','too_long'])('checks delegated consent %s without network',async variant=>{
 const scope={max_new_jev_calls:79},now=Date.now(),directive='GO bc00633a-30d8-4a90-8e22-dcc6a0efaeb9 jev_categories4_direct_1pass_v1';
 const b:Record<string,unknown>={executor_version:REST79_VERSION,consent_source:'user_directive_codex_delegation',authority_user_id:'MOCK_OWNER',scope,
 directive,directive_sha256:await analysisTextSha256(directive),executor_code_commit:'a'.repeat(40),created_at:new Date(now-1000).toISOString(),expires_at:new Date(now+60_000).toISOString()};
 if(variant==='expired')b.expires_at=new Date(now-1).toISOString();if(variant==='wider_scope')b.scope={max_new_jev_calls:80};
 if(variant==='changed_directive')b.directive=directive+' changed';if(variant==='wrong_authority')b.authority_user_id='other';
 if(variant==='missing_go')b.directive='no';if(variant==='wrong_code')b.executor_code_commit='unknown';if(variant==='too_long')b.expires_at=new Date(now+25*3600_000).toISOString();
 if(variant==='valid')expect(await verifyRest79Consent(b,scope,'MOCK_OWNER',now)).toBe(true);
 else await expect(verifyRest79Consent(b,scope,'MOCK_OWNER',now)).rejects.toThrow('GO_OR_SCOPE');
});
it('produces 80 unique review rows, deduplicated category counts, and separates pilot usage from 79 new calls',async()=>{
 const p=await fixture(),pilot=await saved(p,DIRECT_PILOT_REVIEW),fresh=[];
 for(const r of p.body.reviews.filter(r=>r.review_id!==DIRECT_PILOT_REVIEW))fresh.push(await saved(p,r.review_id));
 const d=await aggregateDirect80(p,pilot.result,pilot.receipt,fresh);
 expect(d.reviews).toHaveLength(80);expect(d.counts.total_reviews).toBe(80);expect(d.counts.any_category_mentioned_reviews).toBe(80);
 expect(d.counts.categories.service).toMatchObject({exclusive:{mixed:80},positive_including_mixed:80,negative_including_mixed:80,distinct_mentioned_reviews:80});
 expect(d.counts.categories.price.exclusive.not_mentioned).toBe(80);expect(d.counts.categories.ambiance.exclusive.neutral).toBe(80);
 expect(d.usage.reused_pilot).toMatchObject({reviews:1,input_tokens_known:10,output_tokens_known:0});
 expect(d.usage.new79).toMatchObject({reviews:79,input_tokens_known:790,output_tokens_known:0});expect(d.new_provider_calls).toBe(79);
 await expect(aggregateDirect80(p,pilot.result,pilot.receipt,[...fresh.slice(1),pilot])).rejects.toThrow('80_UNIQUE');
});
it('keeps native uncertainty and network failure distinct from absence, with missing telemetry explicit',async()=>{
 const p=await fixture(),pilot=await saved(p,DIRECT_PILOT_REVIEW),fresh=[];
 const remaining=p.body.reviews.filter(r=>r.review_id!==DIRECT_PILOT_REVIEW);
 for(let i=0;i<remaining.length;i++)fresh.push(await saved(p,remaining[i].review_id,i===0?'network':i===1?'uncertain':'normal'));
 const d=await aggregateDirect80(p,pilot.result,pilot.receipt,fresh);
 expect(d.errors).toHaveLength(1);expect(d.uncertainties).toHaveLength(1);expect(d.counts.received_results).toBe(79);
 expect(d.counts.categories.ambiance.exclusive).toMatchObject({unavailable:1,uncertain:1,not_mentioned:0,neutral:78});
 expect(d.usage.new79.unknown_usage_review_ids).toEqual([remaining[0].review_id]);expect(d.usage.new79.known_usage_calls).toBe(78);
});
it.each(['text_hash','configuration','request','receipt_hash','raw_text'])('rejects incompatible saved proof %s',async variant=>{
 const p=await fixture(),x=await saved(p,DIRECT_PILOT_REVIEW);
 if(variant==='text_hash')x.result.body.analysis_text_sha256='changed';if(variant==='configuration')x.result.body.configuration_sha256='changed';
 if(variant==='request')x.result.body.request_sha256='changed';if(variant==='receipt_hash')x.receipt.sha256='changed';if(variant==='raw_text')x.receipt.body.raw_response_text='changed';
 x.result.sha256=await directHash(x.result.body);await expect(verifyDirectSaved(p,x.result,x.receipt)).rejects.toThrow();
});
it('never returns an old reservation and refuses a position beyond the 79-review scope',async()=>{
 let inserts=0;const fake={from:()=>{const b={select:()=>b,eq:()=>b,like:()=>b,limit:async()=>({data:[],error:null}),single:async()=>({data:{protocol_id:'parent',organization_id:'org'},error:null}),
 insert:()=>{inserts++;return {select:()=>({single:async()=>({data:null,error:{code:'23505'}})})};}};return b;}};
 const port=rest79Port(fake as unknown as Parameters<typeof rest79Port>[0]);await port.load('mock');
 expect(await port.reserve(REST79_PREFIX+'attempt_01',{},'sha')).toBeNull();
 await expect(port.reserve(REST79_PREFIX+'attempt_80',{},'sha')).rejects.toThrow('SCOPE_INVALID');expect(inserts).toBe(1);
});
