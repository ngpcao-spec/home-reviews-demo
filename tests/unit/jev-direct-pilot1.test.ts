import {it,expect,vi,beforeAll,afterAll} from 'vitest';
import {verifyDirectPilotConsent,directPilotHandler,DIRECT_PILOT_VERSION,DIRECT_PILOT_REVIEW} from '../../supabase/functions/_shared/jev-direct-pilot1';
import {directPilotPort} from '../../supabase/functions/_shared/jev-direct-pilot1-store';
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text';
let net:ReturnType<typeof vi.spyOn>;
beforeAll(()=>{net=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('PROVIDER_NETWORK_FORBIDDEN'));});
afterAll(()=>{expect(net).not.toHaveBeenCalled();net.mockRestore();});
async function consent(){const directive='GO synthetic offline only '+DIRECT_PILOT_REVIEW,now=Date.now(),scope={max_jev_calls:1,max_questions:4,automatic_retry:false};
 return {scope,now,body:{executor_version:DIRECT_PILOT_VERSION,consent_source:'user_directive_codex_delegation',authority_user_id:'synthetic-owner',
 directive,directive_sha256:await analysisTextSha256(directive),executor_code_commit:'a'.repeat(40),scope,
 created_at:new Date(now-1000).toISOString(),expires_at:new Date(now+60_000).toISOString()} as Record<string,unknown>};}
it('accepts a fresh single-review consent only with its exact scope, directive hash and provenance',async()=>{
 const f=await consent();expect(await verifyDirectPilotConsent(f.body,f.scope,'synthetic-owner',f.now)).toBe(true);
});
it.each(['absent_go','expired','future','too_long','scope','wrong_user','directive_hash','source','version','code','different_review'])('blocks consent %s without a supplier call',async kind=>{
 const f=await consent();
 if(kind==='absent_go')f.body.directive='not authorized';if(kind==='expired')f.body.expires_at=new Date(f.now-1).toISOString();
 if(kind==='future')f.body.created_at=new Date(f.now+1000).toISOString();if(kind==='too_long')f.body.expires_at=new Date(f.now+25*3600_000).toISOString();
 if(kind==='scope')f.body.scope={...f.scope,max_jev_calls:80};if(kind==='wrong_user')f.body.authority_user_id='other';
 if(kind==='directive_hash')f.body.directive_sha256='0'.repeat(64);if(kind==='source')f.body.consent_source='fake_phone_click';
 if(kind==='version')f.body.executor_version='other';if(kind==='code')f.body.executor_code_commit='none';
 if(kind==='different_review')f.body.directive='GO different-review';
 await expect(verifyDirectPilotConsent(f.body,f.scope,'synthetic-owner',f.now)).rejects.toThrow('GO_OR_SCOPE');
});
it('rejects GET, unauthorized POST and an extra batch field before starting any job',async()=>{
 const run=vi.fn(async()=>{}),waitUntil=vi.fn(),authenticate=vi.fn(async()=>false),handler=directPilotHandler({run,waitUntil,authenticate});
 expect((await handler(new Request('https://offline.test'))).status).toBe(405);expect(authenticate).not.toHaveBeenCalled();
 expect((await handler(new Request('https://offline.test',{method:'POST',body:'{}'}))).status).toBe(401);authenticate.mockResolvedValue(true);
 expect((await handler(new Request('https://offline.test',{method:'POST',body:JSON.stringify({execution_id:'a'.repeat(36),batch:true})}))).status).toBe(400);
 expect(run).not.toHaveBeenCalled();expect(waitUntil).not.toHaveBeenCalled();
});
it('hands off exactly one explicit execution to server background processing, without depending on the phone',async()=>{
 const run=vi.fn(async()=>({status:'mocked'})),pending:Promise<unknown>[]=[],handler=directPilotHandler({run,authenticate:async()=>true,waitUntil:p=>pending.push(p)});
 const id='00000000-0000-4000-8000-000000000001';
 expect((await handler(new Request('https://offline.test',{method:'POST',body:JSON.stringify({execution_id:id})}))).status).toBe(202);
 await Promise.all(pending);expect(run).toHaveBeenCalledExactlyOnceWith(id);
});
it('uses an atomic insert with no upsert; a uniqueness conflict never returns an old reservation',async()=>{
 const insert=vi.fn(()=>({select:()=>({single:async()=>({data:null,error:{code:'23505'}})})}));
 const fake={from:()=>({select:()=>({eq:()=>({single:async()=>({data:{protocol_id:'parent',organization_id:'org'},error:null})})}),insert}),
 auth:{admin:{getUserById:async()=>({data:{user:{id:'u'}},error:null})}}};
 const port=directPilotPort(fake as unknown as Parameters<typeof directPilotPort>[0]);await port.load('offline-execution');
 expect(await port.reserve({request_count:1},'sha')).toBeNull();expect(insert).toHaveBeenCalledOnce();
});
