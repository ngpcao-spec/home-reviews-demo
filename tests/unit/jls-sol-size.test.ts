import {it,expect,vi} from "vitest";
import {SOL_SIZE_POLICY,solRequestSize} from "../../supabase/functions/_shared/jls-sol-size";
import {prepareRestaurantResume,verifyRestaurantProtocol,restaurantConfiguration,restaurantEvidencePlan,verifyRestaurantResumePlan} from "../../supabase/functions/_shared/jls-restaurant";
import {conditionalEditorialRequest} from "../../supabase/functions/_shared/jls-prioritized-editorial";
import {hybridHash} from "../../supabase/functions/_shared/jev-hybrid-evidence";
import {gardenFixture} from "../fixtures/jls-restaurant";
import {processRestaurant,restaurantAttempt} from "../../supabase/functions/_shared/jls-restaurant-worker";
const request=(n:number)=>({model:"gpt-6.1-sol",max_output_tokens:9500,input:[{role:"system",content:"instructions"},{role:"user",content:"word ".repeat(n)}],text:{format:{schema:{type:"object"}}}});
it("full serialized request uses bounded 32k, byte limit, output reserve and explicit margin",()=>{
 const m=solRequestSize(request(21000));expect(m.guarded_input_tokens).toBeGreaterThan(20000);expect(m.guarded_input_tokens).toBeLessThan(32768);
 expect(m.margin_tokens).toBe(Math.ceil(m.local_input_tokens*1.12)+256-m.local_input_tokens);
 expect(m.output_reserved_tokens).toBe(9500);expect(m.total_reserved_tokens).toBeLessThan(1050000);
 expect(m.request_bytes).toBe(new TextEncoder().encode(JSON.stringify(request(21000))).length);
});
it("over-limit requests are rejected instead of dropping quotes",()=>{
 expect(()=>solRequestSize(request(40000))).toThrow("JLS_SOL_TOKEN_BUDGET_EXCEEDED");
 expect(()=>solRequestSize(request(220000))).toThrow("JLS_SOL_REQUEST_BYTES_EXCEEDED");
});
it("model/output/policy changes cannot silently expand the envelope",()=>{
 expect(()=>solRequestSize({...request(10),model:"other"})).toThrow("JLS_SOL_ENVELOPE_MODEL_OR_OUTPUT_CHANGED");
 expect(()=>solRequestSize({...request(10),max_output_tokens:128001})).toThrow("JLS_SOL_ENVELOPE_MODEL_OR_OUTPUT_CHANGED");
 expect(()=>solRequestSize(request(10),{...SOL_SIZE_POLICY,input_budget_tokens:999999} as typeof SOL_SIZE_POLICY)).toThrow("JLS_SOL_SIZE_POLICY_CHANGED");
});
it("historical restaurant configuration SHA and 20k cap remain unchanged",async()=>{
 const c=await restaurantConfiguration();expect(c.policy.input_budget_tokens).toBe(20000);
 expect(await hybridHash(c)).toBe("32c42a3f3cfbb4748154f9c941a54f5883068be01c73f7a7df2d810ce940f2e2");
});
async function completedFixture(){const f=await gardenFixture();f.authorize();for(let i=0;i<2;i++)await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},f.http);return f;}
const history={source_protocol_id:"11111111-1111-4111-8111-111111111111",source_protocol_sha256:"a".repeat(64),source_run_id:"22222222-2222-4222-8222-222222222222"};
it("restart reuses complete cache, preserves history, all quotes and grouped requests; no network",async()=>{
 const f=await completedFixture(),before=JSON.stringify(f.state),calls=f.calls.length;
 const p=await prepareRestaurantResume(f.state.protocol.body.snapshot,f.cache,[],"synthetic restart","jev-1.13.0",history);
 const net=vi.spyOn(globalThis,"fetch").mockImplementation(()=>{throw Error("PROVIDER_FORBIDDEN");});
 try{
 await verifyRestaurantProtocol(p,await hybridHash(p));expect(p.max_jev_calls).toBe(0);expect(p.cache).toHaveLength(12);
 const plan=await restaurantEvidencePlan(p,f.cache);await verifyRestaurantResumePlan(p,plan);
 const conditional=await conditionalEditorialRequest(plan);expect(JSON.parse(conditional.request.input[1].content).evidence).toHaveLength(plan.selected.length);
 expect(p.max_luna_calls).toBe(new Set(plan.selected.map(e=>e.review_id)).size);expect(p.max_sol_calls).toBe(1);
 expect(plan.sol_size_policy?.input_budget_tokens).toBe(32768);expect(plan.evidence_decisions).toBeNull();
 expect(JSON.stringify(p)).not.toMatch(/estimated_cost|approved_estimates|cost_confirmed/);
 expect(net).not.toHaveBeenCalled();expect(f.calls).toHaveLength(calls);expect(JSON.stringify(f.state)).toBe(before);
 }finally{net.mockRestore();}
},15000);
it("missing cache or altered preflight blocks a restart",async()=>{
 const f=await completedFixture(),s=f.state.protocol.body.snapshot;
 await expect(prepareRestaurantResume(s,[],[],"test","jev-1.13.0",history)).rejects.toThrow("JLS_RESTART_REQUIRES_COMPLETE_COMPATIBLE_CACHE");
 const p=await prepareRestaurantResume(s,f.cache,[],"test","jev-1.13.0",history);
 p.resume!.conditional_sol.measurement.request_bytes++;
 await expect(verifyRestaurantProtocol(p,await hybridHash(p))).rejects.toThrow("JLS_RESTAURANT_PROTOCOL_CHANGED");
},15000);
it("dispatch checks full size before HTTP even after durable reservation",async()=>{
 const f=await gardenFixture(),q=request(40000),sha=await hybridHash(q);f.state.protocol.body.sol_size_policy=SOL_SIZE_POLICY;
 const t={...f.state.tasks[0],phase:"sol" as const,request:q,request_sha256:sha,request_count:1,status:"running"};
 f.state.artifacts.push({kind:"sol_dossier",sha256:"",body:{gate:{passed:true},draft:{request_sha256:sha,
 prompt_sha256:f.state.protocol.body.configuration.sol_prompt_sha256,schema_sha256:f.state.protocol.body.configuration.sol_schema_sha256}}});
 const http=vi.fn();const out=await restaurantAttempt(t,f.state,"mock",http);
 expect(http).not.toHaveBeenCalled();expect(out.status).toBe("blocked");expect(out.body.error_code).toBe("JLS_SOL_TOKEN_BUDGET_EXCEEDED");
});

it("distinct restart reaches Luna without any JEV credential or dispatch; no GO means no dispatch",async()=>{
 const f=await completedFixture(),p=await prepareRestaurantResume(f.state.protocol.body.snapshot,f.cache,[],"test","jev-1.13.0",history);
 f.state.protocol={id:crypto.randomUUID(),body:p,sha256:await hybridHash(p)};
 f.state.run={id:crypto.randomUUID(),stage:"jev",status:"queued"};f.state.tasks=[];f.state.artifacts=[];
 const before=f.calls.length;await processRestaurant(f.port,f.state.run.id,{jev:"",openai:"mock"},f.http);
 expect(f.calls).toHaveLength(before);expect(f.state.run.stage).toBe("luna");expect(f.state.tasks.every(t=>t.phase==="luna"&&t.request_count===0)).toBe(true);
 const sha=f.state.protocol.sha256;p.sol_size_policy={...SOL_SIZE_POLICY,input_budget_tokens:999999} as typeof SOL_SIZE_POLICY;
 await expect(verifyRestaurantProtocol(p,sha)).rejects.toThrow("JLS_RESTAURANT_PROTOCOL_CHANGED");
},15000);
