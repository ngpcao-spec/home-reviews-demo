import {afterEach,afterAll,beforeAll,expect,it,vi} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import {I18nProvider} from "../../src/i18n";
import {JlsRestaurantPreparation} from "../../src/components/analysis/JlsRestaurantPreparation";
import {contractReportView} from "../../supabase/functions/_shared/jls-contract-v2-view";
import {contractReadRows,contractViewFixture} from "../fixtures/jls-contract-v2-view";
import {readFileSync} from "node:fs";
let net:ReturnType<typeof vi.spyOn>;
beforeAll(()=>{net=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("PROVIDER_NETWORK_FORBIDDEN"));});
afterEach(cleanup);
afterAll(()=>{expect(net).not.toHaveBeenCalled();net.mockRestore();});
it("projects the saved V2 report without raw response, consent, secret or mutation",async()=>{
 const f=await contractReadRows(),before=JSON.stringify(f),v=await contractReportView(f.protocol,f.operation,f.scope);
 expect(v.report?.report.recommendations.length).toBeGreaterThan(0);expect(v.new_paid_calls).toBe(0);
 expect(JSON.stringify(v)).not.toMatch(/raw_response_text|consent|SYNTHETIC RAW/);expect(JSON.stringify(f)).toBe(before);
 expect(v.costs.sol).toBeNull();
});
it.each(["organization","establishment","operation_organization","protocol","mock"])("rejects incompatible %s",async(kind)=>{
 const f=await contractReadRows();
 if(kind==="organization")f.protocol.organization_id="other";
 if(kind==="establishment")f.protocol.establishment_id="other";
 if(kind==="operation_organization")f.operation.organization_id="other";
 if(kind==="protocol")f.operation.protocol_id="other";
 if(kind==="mock")f.operation.mode="mock";
 await expect(contractReportView(f.protocol,f.operation,f.scope)).rejects.toThrow("FORBIDDEN");
});
it.each(["result","luna_result"] as const)("rejects a changed %s",async(key)=>{
 const f=await contractReadRows();f.operation[key]!.changed=true;
 await expect(contractReportView(f.protocol,f.operation,f.scope)).rejects.toThrow("JLS_RESULT_CHANGED");
});
it("keeps incomplete executions read-only and never invents a report",async()=>{
 const f=await contractReadRows();f.operation.result=null;f.operation.result_sha256=null;f.operation.status="billing_uncertain";
 expect((await contractReportView(f.protocol,f.operation,f.scope)).report).toBeNull();
});
it.each(["fr","vi"] as const)("%s exposes the saved report even without a legacy protocol",language=>{
 const v=contractViewFixture();render(<I18nProvider language={language}><JlsRestaurantPreparation data={{protocol:null,run:null,result:null,progress:null,contract_v2:v}}/></I18nProvider>);
 expect(screen.getByTestId("jls-contract-v2-report")).toHaveTextContent("SYNTHETIC V2 REPORT");
 expect(screen.getByText(v.report!.report.conclusion.text!)).toBeVisible();
 expect(screen.getAllByText(language==="fr"?"Action proposée au restaurateur":"Hành động đề xuất cho nhà hàng").length).toBeGreaterThan(0);
 expect(screen.queryByRole("button")).toBeNull();
});
it("GET access remains authenticated, scoped and separate from historical reads and workers",()=>{
 const api=readFileSync("supabase/functions/jls-restaurant/index.ts","utf8");
 expect(api).toContain('r.method!=="GET"');expect(api).toContain('await assertMembership(c.client');
 expect(api).toContain('.eq("organization_id",er.data.organization_id)');expect(api).toContain('.eq("mode","paid")');
 expect(api.indexOf("contractReportView(cp.data")).toBeLessThan(api.indexOf("verifyRestaurantProtocol(p.body"));
 expect(api).not.toMatch(/c\.admin|\.rpc\(|\.insert\(|\.update\(|wake_|authorize_/);
 const page=readFileSync("src/pages/JevLunaSolPage.tsx","utf8");
 expect(page).toContain('params.get("establishment_id")');expect(page).toContain('view:"historical"');
});
