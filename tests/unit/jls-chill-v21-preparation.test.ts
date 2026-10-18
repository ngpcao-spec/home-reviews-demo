import {expect,it,vi} from "vitest";
import {CHILL_V21,CHILL_V21_POLICY,chillV21Expected,verifyChillV21} from "../../supabase/functions/_shared/jls-chill-v21-preparation";
import {processContractV2,type ContractPort,type ContractState} from "../../supabase/functions/_shared/jls-contract-v2-worker";
import {hybridHash} from "../../supabase/functions/_shared/jev-hybrid-evidence";
import {CONTRACT_V2_POLICY} from "../../supabase/functions/_shared/jls-contract-v2-preparation";
it("preserves the archived V2.1 prompt, schema and config identities",async()=>{
 expect(await chillV21Expected()).toEqual({version:"jls-recommendation-contract-v2.1",
  prompt_sha256:"e1f45fc531b8d820b03c195fa8c8c6b683e897a139c89c9c74a58776df4d53f0",
  schema_sha256:"fdc76cc245c66dc7156715a6ad583cd5e998089628ff36fd514d1911e21b5c2f",
  config_sha256:"6633ed5a8a24d957bc3a6e27c9eff22918f86853758bd089e7e48fa3fbf291da"});
});
it("isolates the protocol while preserving the original one-shot, durable-stage policy",()=>{
 expect(CHILL_V21).not.toBe(CONTRACT_V2_POLICY.version);
 expect(CHILL_V21_POLICY).toEqual({...CONTRACT_V2_POLICY,version:CHILL_V21});
});
it("refuses an unsealed protocol before reservation or any provider access",async()=>{
 const p={version:CHILL_V21},state={operation:{status:"queued",phase:"luna",mode:"mock"},protocol:{body:p,sha256:await hybridHash(p)},source:{}} as ContractState;
 const claim=vi.fn(),http=vi.fn(),port={load:async()=>state,active:async()=>{},claim,abort:vi.fn()} as unknown as ContractPort;
 expect(await processContractV2(port,"synthetic","mock",http)).toMatchObject({error_code:"JLS_V2_PROTOCOL_CHANGED",provider_calls:0});
 expect(claim).not.toHaveBeenCalled();expect(http).not.toHaveBeenCalled();
 await expect(verifyChillV21(state.protocol,state.source)).rejects.toThrow("JLS_V2_PROTOCOL_CHANGED");
});
