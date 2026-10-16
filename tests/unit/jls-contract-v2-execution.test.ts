import {expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
import {CONTRACT_V2_POLICY} from "../../supabase/functions/_shared/jls-contract-v2-preparation";
import {processContractV2,type ContractPort,type ContractState} from "../../supabase/functions/_shared/jls-contract-v2-worker";
it("V2 is bounded to one Luna question, one Sol, zero JEV/Apify and zero retries",()=>{
 expect(CONTRACT_V2_POLICY).toMatchObject({max_jev_calls:0,max_luna_calls:1,max_questions:1,max_sol_calls:1,apify_calls:0,automatic_retry:false,provider_client_retries:0,tokenizations_at_wake:0,production_enabled:false});
});
it.each(["completed","needs_review","billing_uncertain","blocked","invalid_output","authorization_expired"])("terminal %s cannot reserve or dispatch",async status=>{
 const unexpected=vi.fn(async()=>{throw Error("UNEXPECTED_OPERATION");});
 const port:ContractPort={load:async()=>({operation:{status,mode:"mock",phase:"luna"}} as ContractState),active:unexpected,compatible:unexpected,claim:unexpected,receive:unexpected,finishLuna:unexpected,finishSol:unexpected,abort:unexpected};
 const http=vi.fn();for(let i=0;i<3;i++)expect(await processContractV2(port,"fixture","mock",http)).toMatchObject({phase:"already_recorded",provider_calls:0});
 expect(http).not.toHaveBeenCalled();expect(unexpected).not.toHaveBeenCalled();
});
it("absence of delegated authorization blocks before source loading, reservation or dispatch",async()=>{
 const port={load:async()=>({operation:{status:"queued",mode:"mock",phase:"luna"},protocol:{body:{}}} as ContractState),
 active:async()=>{throw Error("JLS_V2_NEW_GO_REQUIRED");},abort:vi.fn(),claim:vi.fn()} as unknown as ContractPort;
 const http=vi.fn();expect(await processContractV2(port,"fixture","mock",http)).toMatchObject({error_code:"JLS_V2_NEW_GO_REQUIRED",provider_calls:0});
 expect(port.claim).not.toHaveBeenCalled();expect(http).not.toHaveBeenCalled();
});
it("SQL guards scope, expiry, organization, immutable results, concurrency and both one-shot counters",()=>{
 const sql=readFileSync("supabase/migrations/20261016022029_jls_contract_v2_delegated_preparation.sql","utf8");
 for(const required of ["for update","luna_count in(0,1)","sol_count in(0,1)","enable row level security","JLS_V2_NEW_GO_REQUIRED","JLS_V2_LOST_ATTEMPT_NO_RETRY","JLS_V2_RESULT_IMMUTABLE","user_directive_codex_delegation","24 hours","JLS_V2_FULL_PATH_NOT_QUALIFIED"])expect(sql).toContain(required);
 expect(sql).not.toContain("security definer");expect(sql).not.toMatch(/select\s+(?:public\.)?authorize_jls_contract_v2\s*\(/);
});
it("immutable-parent guard avoids duplicate canonicalization while retaining live/native and worker body hashes",()=>{
 const sql=readFileSync("supabase/migrations/20261016025619_jls_contract_v2_immutable_source_guard.sql","utf8");
 expect(sql).toContain("public.check_jls_sol_ready_sources(a.body)");expect(sql).toContain("source_archive_sha256");
 expect(sql).not.toContain("public.jls_restaurant_hash(a.body)");expect(sql).not.toContain("public.jls_restaurant_hash(r.body)");
 const verifier=readFileSync("supabase/functions/_shared/jls-contract-v2-preparation.ts","utf8");expect(verifier).toContain("await hybridHash(source.artifact.body)!==source.artifact.sha256");
 const rpc=readFileSync("supabase/migrations/20261016030105_jls_contract_v2_rpc_jit_guard.sql","utf8");
 expect(rpc).toContain("ALTER FUNCTION public.check_jls_contract_v2_sources(uuid) SET jit TO 'off'");
 expect(rpc).not.toMatch(/ALTER\s+(?:ROLE|DATABASE)/i);
});
