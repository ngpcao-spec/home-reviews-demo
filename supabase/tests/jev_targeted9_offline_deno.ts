import {processTargeted9,type Target9Port,type Target9Record} from '../functions/_shared/jev-targeted9-worker.ts';
import {prepareTargetedJev} from '../functions/_shared/jev-boundaries-targeted-protocol.ts';
import {hybridHash} from '../functions/_shared/jev-hybrid-evidence.ts';
import {negativeHash} from '../functions/_shared/negative-validation-core.ts';
import {THEME_KEYS} from '../functions/_shared/jev-themes.ts';
import frozen from '../../tests/fixtures/jev-boundaries-targeted9.json' with {type:'json'};
import criteria from '../../docs/jev-boundaries-targeted9-criteria-20261018.json' with {type:'json'};
Deno.test('frozen nine: complete worker path uses one injected transport per review, no network permission',async()=>{
 const protocol=await prepareTargetedJev(frozen.source,criteria as Parameters<typeof prepareTargetedJev>[1],frozen.baseline);
 const pid='3f6ab86c-7557-431b-9389-4fa85054a00e',id=crypto.randomUUID(),directive='Synthetic offline transport only';
 const body={targeted_protocol_id:pid,protocol_sha256:protocol.sha256,configuration_sha256:protocol.body.configuration_sha256,
 request_manifest_sha256:protocol.body.request_manifest_sha256,scope:protocol.body.policy,consent_source:'user_directive_codex_delegation',
 directive,directive_sha256:await negativeHash(directive),expires_at:new Date(Date.now()+60000).toISOString()};
 const execution={id,kind:'jev_targeted9_execution_v1',body,sha256:await hybridHash(body)},records:Target9Record[]=[];let calls=0;
 const port:Target9Port={load:()=>Promise.resolve({protocol,protocol_id:pid,execution,records}),reserve:()=>Promise.resolve(crypto.randomUUID()),
 save:async(kind,body)=>{const r={id:crypto.randomUUID(),kind,body,sha256:await hybridHash(body)};records.push(r);return r.id;},wake:()=>Promise.resolve()};
 const mock:typeof fetch=()=>{calls++;return Promise.resolve(new Response(JSON.stringify({model:'jev-1.13.0',usage:{input_tokens:10,output_tokens:0},
 answers:Object.fromEntries(THEME_KEYS.map(k=>[k,{type:'choice',choice:'absent',probabilities:{absent:1,positive:0,negative:0,both:0}}]))})));};
 for(let i=0;i<9;i++)if(await processTargeted9(port,id,'EXPLICIT_TEST_KEY',mock)!=='completed_one')throw Error('MOCK_PATH_FAILED');
 if(await processTargeted9(port,id,'EXPLICIT_TEST_KEY',mock)!=='finished'||calls!==9)throw Error('CALL_LIMIT_FAILED');
});
