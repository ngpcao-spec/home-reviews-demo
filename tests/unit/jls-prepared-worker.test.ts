import {it,expect,vi} from "vitest";
import {gardenFixture} from "../fixtures/jls-restaurant";
import {prepareRestaurantResume,verifyRestaurantProtocol,restaurantSol} from "../../supabase/functions/_shared/jls-restaurant";
import {compilePreparedRestaurant,verifyPreparedArtifact} from "../../supabase/functions/_shared/jls-restaurant-prepared";
import {attachPlanTokenMemo,planTokenMemo,tokenCertificate} from "../../supabase/functions/_shared/jls-token-memo";
import {hybridHash} from "../../supabase/functions/_shared/jev-hybrid-evidence";
import {technicalLunaMocks,preparedCpuExercise,probeCpuMillis} from "../../supabase/functions/_shared/jls-restaurant-cpu-probe";
import {processRestaurant} from "../../supabase/functions/_shared/jls-restaurant-worker";
import {readFileSync} from "node:fs";
async function fixture(){const f=await gardenFixture();f.authorize();for(let i=0;i<2;i++)await processRestaurant(f.port,f.state.run.id,{jev:"mock",openai:"mock"},f.http);
 const p=await prepareRestaurantResume(f.state.protocol.body.snapshot,f.cache,[],"synthetic","jev-1.13.0",{source_protocol_id:crypto.randomUUID(),source_protocol_sha256:"a".repeat(64),source_run_id:crypto.randomUUID()});
 const c=await compilePreparedRestaurant({id:crypto.randomUUID(),body:p,sha256:await hybridHash(p)},crypto.randomUUID(),"SYNTHETIC COMPILER");
 f.state.protocol={id:crypto.randomUUID(),...c.protocol};f.state.run={id:crypto.randomUUID(),stage:"jev",status:"queued"};f.state.tasks=[];f.state.artifacts=[];
 f.port.prepared=async()=>c.artifact;f.port.cacheCompatible=async()=>true;
 return {...f,c};}
it("frozen preparation has no consent/paid task; worker reconstructs no plan on repeated wakes",async()=>{
 const f=await fixture(),before=f.calls.length;await verifyRestaurantProtocol(f.c.protocol.body,f.c.protocol.sha256);
 const net=vi.spyOn(globalThis,"fetch").mockImplementation(()=>{throw Error("PROVIDER_FORBIDDEN");});
 try{await Promise.all(Array.from({length:8},()=>processRestaurant(f.port,f.state.run.id,{jev:"",openai:"mock"},f.http)));
 expect(f.calls).toHaveLength(before);expect(f.state.run.stage).toBe("luna");expect(f.state.tasks).toHaveLength(f.c.protocol.body.max_luna_calls);
 expect(f.state.tasks.every(t=>t.request_count===0)).toBe(true);expect(net).not.toHaveBeenCalled();}finally{net.mockRestore();}
});
it("durable free preparation stage survives closure and Sol is dispatched once",async()=>{
 const f=await fixture();const previous=f.calls.length;
 await processRestaurant(f.port,f.state.run.id,{jev:"",openai:"mock"},f.http);
 for(let i=0;i<2;i++)await processRestaurant(f.port,f.state.run.id,{jev:"",openai:"mock"},f.http);
 expect(f.state.run.stage).toBe("prepare_sol");expect(f.calls.slice(previous).every(x=>x.endsWith("/decisions"))).toBe(true);
 await processRestaurant(f.port,f.state.run.id,{jev:"",openai:"mock"},f.http);expect(f.state.run.stage).toBe("sol");
 const body=f.state.artifacts.find(a=>a.kind==="sol_dossier")!.body;
 expect(body.token_certificate).toBeTruthy();expect(body.request_json).toBeTruthy();
 // JSONB changes key order: restore the wire string rather than retokenizing it.
 f.state.tasks.forEach(t=>{t.request=Object.fromEntries(Object.entries(t.request as object).sort(([a],[b])=>a.localeCompare(b)));});
 await processRestaurant(f.port,f.state.run.id,{jev:"",openai:"mock"},f.http);
 expect(f.state.run.status,f.getError()??undefined).toBe("completed");
 await processRestaurant(f.port,f.state.run.id,{jev:"",openai:"mock"},f.http);
 expect(f.calls.filter(x=>x.endsWith("/responses"))).toHaveLength(1);
},15000);
it.each(["no_go","expired"])("%s blocks before any provider",async(mode)=>{
 const f=await fixture();if(mode==="expired")f.expire();else f.port.tick=async()=>false;const http=vi.fn(f.http);await processRestaurant(f.port,f.state.run.id,{jev:"",openai:"mock"},http);expect(http).not.toHaveBeenCalled();
});
it.each(["artifact","certificate","source","cache"])("changed %s blocks before reservation/HTTP",async(kind)=>{
 const f=await fixture();if(kind==="artifact")f.c.artifact.body.plan.selected[0].quote+="changed";
 if(kind==="certificate")f.c.artifact.body.token_certificate.entries[0].tokens++;
 if(kind==="source")f.state.protocol.body.snapshot.source.reviews[0].analysis_text+="changed";
 if(kind==="cache")f.port.cacheCompatible=async()=>false;
 const http=vi.fn(f.http);await processRestaurant(f.port,f.state.run.id,{jev:"",openai:"mock"},http);expect(http).not.toHaveBeenCalled();expect(f.state.run.status).toBe("blocked");
});
it("sealed measurements refuse cache misses instead of initializing a tokenizer in dispatch",async()=>{
 const p={},m=await attachPlanTokenMemo(p);m.count("synthetic measured input");const cert=await tokenCertificate(p);
 const sealed=await attachPlanTokenMemo(p,cert,true);expect(sealed.count("synthetic measured input")).toBeGreaterThan(0);
 expect(()=>sealed.count("different unmeasured input")).toThrow("JLS_TOKEN_MEASUREMENT_MISSING");
});
it("prepared request and validators use the same exact probability/quote bindings without token recomputation",async()=>{
 const f=await fixture(),p=f.c.protocol.body,plan=await verifyPreparedArtifact(p,f.c.artifact),ds=await technicalLunaMocks(plan);
 const draft=await restaurantSol(plan,ds);expect(draft.gate.passed).toBe(true);expect(planTokenMemo(plan)!.misses).toBe(0);
 ds[0].quote_sha256="changed";await expect(restaurantSol(plan,ds)).rejects.toThrow("JLS_DECISION_BINDING_CHANGED");
 const a=await preparedCpuExercise(p,f.c.protocol.sha256,f.c.artifact,"verify");expect(a.memo_misses).toBe(0);expect(a.checked_requests).toBe(p.max_luna_calls);
});
it("SQL splits only the free stage; RLS, immutable artifacts and zero retry remain",()=>{
 const sql=readFileSync("supabase/migrations/20261015062832_jls_prepared_cpu_bounded_worker.sql","utf8");expect(sql).toContain("prepare_sol");expect(sql).toContain("enable row level security");expect(sql).toContain("pilot_evidence_immutable");
 expect(sql).not.toMatch(/update public.analysis_jls_restaurant_runs set status='(?:queued|running)'/i);
 const size=readFileSync("supabase/migrations/20261015070100_jls_prepared_sol_size_guard.sql","utf8");
 expect(size).toContain("p_stage='sol' and p.body->>'version' in('jls-restaurant-resume-vi-32k-v1','jls-restaurant-prepared-vi-v1')");
 expect(size).toContain("not between 1 and 32768");expect(size).toContain("is distinct from '9500'");
 const worker=readFileSync("supabase/functions/process-jls-restaurant/index.ts","utf8");expect(worker.indexOf('mode==="cpu_probe"')).toBeLessThan(worker.indexOf('Deno.env.get("OPENAI_API_KEY")'));
});

it("zero/unavailable CPU counters are unknown, never a claim of zero CPU",()=>{
 expect(probeCpuMillis({user:0,system:0},{user:0,system:0})).toBeNull();expect(probeCpuMillis(null,null)).toBeNull();
 expect(probeCpuMillis({user:100,system:10},{user:1000,system:110})).toBe(1);
});
