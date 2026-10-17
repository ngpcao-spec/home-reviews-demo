import {it,expect,vi} from "vitest";
import {readyFixture} from "../fixtures/jls-sol-ready";
import {processReadySol,type ReadyContract} from "../../supabase/functions/_shared/jls-sol-ready-worker";
import {replaySavedResponse} from "../../supabase/functions/_shared/jls-saved-response-replay";
import {verifySolReadyProtocol,verifySolReadyArtifact} from "../../supabase/functions/_shared/jls-sol-ready";
import {validateEditorialReport} from "../../supabase/functions/_shared/jls-editorial-validation";
import {hybridHash} from "../../supabase/functions/_shared/jev-hybrid-evidence";
const source={id:"EXPLICIT_SYNTHETIC_VALIDATION",sha256:"a".repeat(64)},code="b".repeat(40);
const contract:ReadyContract={verify:async s=>{await verifySolReadyProtocol(s.protocol.body,s.protocol.sha256);return verifySolReadyArtifact(s.protocol.body,s.ready);},
 validate:async(raw,s,p)=>validateEditorialReport(raw,p,s.protocol.body.snapshot,s.ready.body.decisions,"vi")};
async function received(){
 const f=await readyFixture();await processReadySol(f.port,f.state.operation.id,"mock",f.http);
 // Explicit synthetic durable receipt; it is never persisted as a paid result.
 f.state.operation.mode="paid";f.state.operation.run_id="SYNTHETIC_RUN";f.state.operation.status="blocked";
 return f;
}
it("replays a blocked saved receipt without a transport, run mutation or consent",async()=>{
 const f=await received(),before=structuredClone(f.state),net=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("NETWORK_FORBIDDEN"));
 try{
  const a=await replaySavedResponse(f.state,contract,source,code),b=await replaySavedResponse(f.state,contract,source,code);
  expect(a).toEqual(b);expect(a.body).toMatchObject({provider_calls:0,new_consent:false,new_paid_run:false,validation_status:"completed"});
  expect(f.state).toEqual(before);expect(net).not.toHaveBeenCalled();expect(f.calls()).toBe(1);
 }finally{net.mockRestore();}
},15000);
it.each(["running","sol","count","receipt","artifact","request"])("refuses changed %s before save",async kind=>{
 const f=await received();
 if(kind==="running")f.state.operation.status="running";
 if(kind==="sol")f.state.operation.phase="sol";
 if(kind==="count")f.state.operation.request_count=0;
 if(kind==="receipt")f.state.operation.receipt!.raw_response_text+=" changed";
 if(kind==="artifact")f.state.ready.body.plan.selected[0].quote+=" changed";
 if(kind==="request")f.state.ready.body.request_json+=" changed";
 await expect(replaySavedResponse(f.state,contract,source,code)).rejects.toThrow();
});
it("concurrent free validations produce the same immutable output, with no second request",async()=>{
 const f=await received();const values=await Promise.all(Array.from({length:4},()=>replaySavedResponse(structuredClone(f.state),contract,source,code)));
 expect(new Set(values.map(v=>v.sha256)).size).toBe(1);expect(f.calls()).toBe(1);
});
it("a failed save acknowledgement can repeat validation without recalling the provider",async()=>{
 const f=await received(),out=await replaySavedResponse(f.state,contract,source,code);let saved:string|null=null;
 const save=vi.fn(async()=>{if(!saved){saved=out.sha256;throw Error("LOST_ACK");}return saved;});
 await expect(save()).rejects.toThrow("LOST_ACK");
 const repeated=await replaySavedResponse(f.state,contract,source,code);
 expect(await save()).toBe(repeated.sha256);expect(f.calls()).toBe(1);
});
it("invalid JSON is preserved as invalid output without correction or dispatch",async()=>{
 const f=await received(),receipt=f.state.operation.receipt!;
 receipt.raw_response_text="{invalid";
 const {negativeHash}=await import("../../supabase/functions/_shared/negative-validation-core");
 receipt.raw_response_sha256=await negativeHash(receipt.raw_response_text);f.state.operation.receipt_sha256=await hybridHash(receipt);
 const out=await replaySavedResponse(f.state,contract,source,code);
 expect(out.body.validation_status).toBe("invalid_output");expect(out.body.result.raw_response_text).toBe("{invalid");expect(f.calls()).toBe(1);
});
