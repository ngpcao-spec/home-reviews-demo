import {beforeAll,beforeEach,afterAll,expect,it,vi} from "vitest";
import {contractReadRows} from "../fixtures/jls-contract-v2-view";
import {requireUser,assertMembership} from "../../supabase/functions/_shared/auth";
vi.mock("../../supabase/functions/_shared/auth",()=>({requireUser:vi.fn(),assertMembership:vi.fn()}));
let handle:(r:Request)=>Promise<Response>,net:ReturnType<typeof vi.spyOn>;
let tables:string[],queries:{table:string;column:string;value:unknown}[],rows:Record<string,Record<string,unknown>|null>;
beforeAll(async()=>{
 net=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("NETWORK_FORBIDDEN"));
 vi.stubGlobal("Deno",{serve:(fn:typeof handle)=>{handle=fn;}});
 await import("../../supabase/functions/jls-restaurant/index");
});
beforeEach(async()=>{
 const f=await contractReadRows();tables=[];queries=[];
 rows={establishments:{id:f.scope.establishment_id,organization_id:f.scope.organization_id,name:f.scope.establishment_name},
  analysis_jls_contract_v2_protocols:{...f.protocol},analysis_jls_contract_v2_operations:{...f.operation},analysis_jls_restaurant_protocols:null};
 const client={from:(table:string)=>{tables.push(table);const q={
  select:()=>q,eq:(column:string,value:unknown)=>{queries.push({table,column,value});return q;},
  neq:(column:string,value:unknown)=>{queries.push({table,column:'neq:'+column,value});return q;},order:()=>q,limit:()=>q,
  in:(column:string,value:unknown)=>{queries.push({table,column:'in:'+column,value});return q;},
  maybeSingle:()=>Promise.resolve({data:rows[table],error:null}),single:()=>Promise.resolve({data:rows[table],error:null})};return q;}};
 vi.mocked(requireUser).mockReset().mockResolvedValue({user:{id:"synthetic-user"},client} as unknown as Awaited<ReturnType<typeof requireUser>>);
 vi.mocked(assertMembership).mockReset().mockResolvedValue("owner");
});
afterAll(()=>{expect(net).not.toHaveBeenCalled();net.mockRestore();vi.unstubAllGlobals();});
const request=(suffix="",method="GET")=>handle(new Request("https://example.test/jls-restaurant?establishment_id=d40d3438-79d8-4c28-8b09-eba640598201"+(suffix||"&view=contract_v2"),{method}));
it("serves the completed V2 result before touching the expensive historical preparation",async()=>{
 const response=await request(),body=await response.json();expect(response.status).toBe(200);
 expect(body.contract_v2.status).toBe("completed");expect(body.contract_v2.report.format_version).toBe("jls-prioritized-recommendations-v2");
 expect(body.history_available).toBe(true);expect(body.new_paid_calls).toBe(0);
 expect(tables).not.toContain("analysis_jls_restaurant_protocols");expect(JSON.stringify(body)).not.toContain("raw_response_text");
 expect(assertMembership).toHaveBeenCalledWith(expect.anything(),"synthetic-user","synthetic-org",["owner","admin","manager"]);
 for(const table of ["analysis_jls_contract_v2_protocols","analysis_jls_contract_v2_operations"])
  expect(queries).toContainEqual({table,column:"organization_id",value:"synthetic-org"});
 expect(queries).toContainEqual({table:"analysis_jls_contract_v2_operations",column:"mode",value:"paid"});
});
it("refuses unauthenticated access before any database read",async()=>{
 vi.mocked(requireUser).mockRejectedValue(Error("UNAUTHORIZED"));expect((await request()).status).toBe(401);expect(tables).toEqual([]);
});
it("refuses membership failure before reading a report",async()=>{
 vi.mocked(assertMembership).mockRejectedValue(Error("FORBIDDEN"));expect((await request()).status).toBe(403);expect(tables).toEqual(["establishments"]);
});
it("rejects a wrong tenant even if a faulty data adapter returned it",async()=>{
 rows.analysis_jls_contract_v2_operations!.organization_id="other-org";expect((await request()).status).toBe(403);
});
it("rejects tampered stored output without showing a legacy result instead",async()=>{
 (rows.analysis_jls_contract_v2_operations!.result as Record<string,unknown>).changed=true;
 expect((await request()).status).toBe(409);expect(tables).not.toContain("analysis_jls_restaurant_protocols");
});
it("keeps explicit historical reads separate from the current report",async()=>{
 expect((await request("&view=historical")).status).toBe(200);
 expect(tables).not.toContain("analysis_jls_contract_v2_operations");expect(tables).toContain("analysis_jls_restaurant_protocols");
 expect(queries).toContainEqual({table:'analysis_jls_restaurant_protocols',column:'neq:body->>version',value:'jls-direct4-execution-v1'});
 expect(queries).toContainEqual({table:'analysis_jls_restaurant_protocols',column:'neq:body->>version',value:'jls-direct4-historical-v1'});
});
it("keeps older clients on their original read contract",async()=>{
 expect((await request("&view=legacy")).status).toBe(200);
 expect(tables).not.toContain("analysis_jls_contract_v2_operations");expect(tables).toContain("analysis_jls_restaurant_protocols");
});
it("falls back when no V2 paid execution exists",async()=>{
 rows.analysis_jls_contract_v2_operations=null;expect((await request()).status).toBe(200);expect(tables).toContain("analysis_jls_restaurant_protocols");
});
it("refuses every POST without authenticating or creating an operation",async()=>{
 const response=await request("","POST");expect(response.status).toBe(405);expect(requireUser).not.toHaveBeenCalled();expect(tables).toEqual([]);
});
it.each(['jls-direct4-execution-v1','jls-direct4-historical-v1'])('serves the %s read contract with no run, while preserving authentication and tenant filters',async version=>{
 rows.analysis_jls_restaurant_protocols={id:'synthetic-direct4',sha256:'synthetic',body:{version}};
 rows.analysis_jls_restaurant_runs=null;
 const response=await request('&view=direct4'),body=await response.json();expect(response.status).toBe(200);
 expect(body.protocol.id).toBe('synthetic-direct4');expect(body.run).toBeNull();expect(body.read_only).toBe(true);expect(body.new_provider_calls).toBe(0);
 expect(tables).not.toContain('analysis_jls_contract_v2_operations');
 expect(queries).toContainEqual({table:'analysis_jls_restaurant_protocols',column:'in:body->>version',value:['jls-direct4-execution-v1','jls-direct4-historical-v1']});
 expect(queries).toContainEqual({table:'analysis_jls_restaurant_runs',column:'organization_id',value:'synthetic-org'});
});
