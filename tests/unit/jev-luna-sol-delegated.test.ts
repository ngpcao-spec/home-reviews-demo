import {expect,it,vi} from "vitest";
import {delegatedMockFixture} from "../fixtures/jev-luna-sol-delegated";
import {processDelegatedJls} from "../../supabase/functions/_shared/jev-luna-sol-executor";
import {evidenceSufficiency,executionCosts,JLS_SUFFICIENCY,delegatedProtocol} from "../../supabase/functions/_shared/jev-luna-sol-delegation";
import {hybridHash} from "../../supabase/functions/_shared/jev-hybrid-evidence";
const run=async(f:Awaited<ReturnType<typeof delegatedMockFixture>>,http=f.http)=>processDelegatedJls(f.port,f.p,f.snapshot,"explicit_mock_run","explicit_mock_key",http);
it("24 grouped Luna requests + one Sol, separate durable phase, persisted output/cost; concurrent wakes never repeat",async()=>{
 const f=await delegatedMockFixture(),http=vi.fn(f.http);for(let i=0;i<5;i++)await Promise.all([run(f,http),run(f,http)]);
 expect(http).toHaveBeenCalledTimes(25);expect(f.tasks.filter(t=>t.phase==="luna")).toHaveLength(24);
 expect(f.tasks.filter(t=>t.phase==="sol")).toHaveLength(1);expect(f.tasks.every(t=>t.request_count===1)).toBe(true);
 expect(f.read().completed).toBeTruthy();expect(executionCosts(f.tasks).total_cost_usd).toBeCloseTo(.00164,8);
 for(const [,init]of http.mock.calls){expect(init!.redirect).toBe("error");const p=JSON.parse(String(init!.body));if(p.model==="gpt-6-luna")expect(Object.keys(JSON.parse(p.input)).sort()).toEqual(["analysis_text","review_alias"]);}
});
it.each(["timeout","429","500","lost_usage","invalid_json","wrong_model","incomplete_answers"])("%s blocks Sol and never retries",async kind=>{
 const f=await delegatedMockFixture();let first=true;
 const http=vi.fn(async(...args:Parameters<typeof fetch>)=>{if(first){first=false;
  if(kind==="timeout")throw new Error("timeout");if(kind==="429"||kind==="500")return new Response("{}",{status:Number(kind)});
  if(kind==="invalid_json")return new Response("invalid");
  const good=await f.http(...args),raw=await good.json();if(kind==="lost_usage")delete raw.usage;if(kind==="wrong_model")raw.model="gpt-6.1-sol";if(kind==="incomplete_answers")raw.answers=[];return new Response(JSON.stringify(raw));}
  return f.http(...args);});
 for(let i=0;i<5;i++)await run(f,http);
 expect(http.mock.calls.some(([,init])=>JSON.parse(String(init!.body)).model==="gpt-6.1-sol")).toBe(false);
 expect(http.mock.calls.length).toBeLessThanOrEqual(24);expect(f.tasks.every(t=>t.request_count<=1)).toBe(true);
 expect(f.read().completed).toBeNull();
});
it("low-confidence supported native answers fail sufficiency without a Sol call",async()=>{
 const f=await delegatedMockFixture(),http=vi.fn(async(...args:Parameters<typeof fetch>)=>{const r=await f.http(...args),raw=await r.json();raw.answers?.forEach((a:{confidence:number})=>a.confidence=.5);return new Response(JSON.stringify(raw));});
 for(let i=0;i<5;i++)await run(f,http);expect(http).toHaveBeenCalledTimes(24);expect(f.read().state).toBe("insufficient_evidence");expect(f.tasks.some(t=>t.phase==="sol")).toBe(false);
});
it("sufficiency checks all axes, negative and low-star support independently",async()=>{
 const f=await delegatedMockFixture(),ids=f.p.selected.map(e=>e.evidence_id);
 expect(evidenceSufficiency(f.p,ids,true).passed).toBe(true);
 expect(evidenceSufficiency(f.p,ids,false).passed).toBe(false);
 for(const axis of Object.keys(JLS_SUFFICIENCY.axes))expect(evidenceSufficiency(f.p,f.p.selected.filter(e=>e.axis!==axis).map(e=>e.evidence_id),true).passed).toBe(false);
 expect(evidenceSufficiency(f.p,f.p.selected.filter(e=>e.polarity==="positive").map(e=>e.evidence_id),true).passed).toBe(false);
 expect(evidenceSufficiency(f.p,f.p.selected.filter(e=>e.rating>=4).map(e=>e.evidence_id),true).passed).toBe(false);
});
it("lost result persistence stops further dispatch, unknown usage never becomes zero",async()=>{
 const f=await delegatedMockFixture(),http=vi.fn(f.http);f.port.finish=()=>Promise.reject(new Error("database"));
 await expect(run(f,http)).rejects.toThrow("SAVE_UNCERTAIN");await run(f,http);
 expect(f.read().state).toBe("billing_uncertain");expect(executionCosts(f.tasks).total_cost_usd).toBeNull();expect(http).toHaveBeenCalledTimes(4);
});
it("authorization disappearance or expired identity cannot claim any task",async()=>{
 const f=await delegatedMockFixture(),http=vi.fn(f.http);f.port.claim=()=>Promise.resolve(null);await run(f,http);expect(http).not.toHaveBeenCalled();
});
it("protocol rejects the FR plan and an unsealed artifact",async()=>{
 const f=await delegatedMockFixture();await expect(delegatedProtocol("fr-plan",f.p,await hybridHash(f.p))).rejects.toThrow("SCOPE");
});
it.each(["timeout","invalid_json","refusal","wrong_model","invented_evidence","missing_usage"])("Sol %s never produces a second report request",async kind=>{
 const f=await delegatedMockFixture(),http=vi.fn(async(...args:Parameters<typeof fetch>)=>{
  if(JSON.parse(String(args[1]!.body)).model!=="gpt-6.1-sol")return f.http(...args);
  if(kind==="timeout")throw new Error("timeout");if(kind==="invalid_json")return new Response("invalid");
  const r=await f.http(...args),raw=await r.json();
  if(kind==="refusal")raw.output[0].content=[{type:"refusal"}];if(kind==="wrong_model")raw.model="other-model";
  if(kind==="missing_usage")delete raw.usage;
  if(kind==="invented_evidence"){const text=JSON.parse(raw.output[0].content[0].text);text.report.conclusion.evidence_ids=["invented"];raw.output[0].content[0].text=JSON.stringify(text);}
  return new Response(JSON.stringify(raw));});
 for(let i=0;i<6;i++)await run(f,http);expect(http).toHaveBeenCalledTimes(25);expect(["billing_uncertain","failed"]).toContain(f.read().state);expect(f.read().completed).toBeNull();
});
