import {it,expect,vi,afterEach} from "vitest";
import {render,screen,cleanup} from "@testing-library/react";
import {hybridHash} from "../../supabase/functions/_shared/jev-hybrid-evidence";
import {negativeHash} from "../../supabase/functions/_shared/negative-validation-core";
import {savedResponseView,type SavedResponseRow,type SavedResponseOperation} from "../../supabase/functions/_shared/jls-saved-response-view";
import {JlsRestaurantPreparation,type RestaurantView} from "../../src/components/analysis/JlsRestaurantPreparation";
import {I18nProvider} from "../../src/i18n";
vi.mock("../../src/components/analysis/PrioritizedJlsReport",()=>({PrioritizedJlsReport:()=> <p>EXPLICIT SYNTHETIC REPORT RENDER</p>}));
afterEach(cleanup);
async function fixture(){
 const native={id:"SYNTHETIC_RESPONSE",model:"gpt-6.1-sol",usage:{input_tokens:10,output_tokens:2},output:[]},raw=JSON.stringify(native),request="a".repeat(64);
 const receipt={raw_response_text:raw,raw_response_sha256:await negativeHash(raw),request_sha256:request},receiptSha=await hybridHash(receipt);
 const result={raw_response_text:raw,response:native,response_sha256:await hybridHash(native),receipt_sha256:receiptSha,served_model:native.model,
 usage:native.usage,input_tokens:10,output_tokens:2,duration_ms:5,validator_version:"synthetic_validator",validated_report:{report:{},validator_version:"synthetic_validator"}};
 const body={version:"jls-saved-response-validation-v1",source_run_id:"run",source_operation_id:"op",source_protocol_sha256:"p-sha",source_artifact_sha256:"artifact-sha",source_request_sha256:request,
 source_receipt_sha256:receiptSha,source_raw_response_sha256:receipt.raw_response_sha256,provider_calls:0,human_validated:false,new_paid_run:false,new_consent:false,
 validation_status:"needs_review",result,result_sha256:await hybridHash(result),validator_code_provenance:"synthetic_commit"};
 const row:SavedResponseRow={id:"saved",organization_id:"org",body,sha256:await hybridHash(body),created_at:"2026-10-17"};
 const scope={organization_id:"org",protocol_id:"p",protocol_sha256:"p-sha",run_id:"run",run_status:"blocked"};
 const op:SavedResponseOperation={id:"op",organization_id:"org",protocol_id:"p",run_id:"run",receipt,receipt_sha256:receiptSha,request_count:1};
 const artifact={id:"artifact",organization_id:"org",source_protocol_id:"p",source_run_id:"run",sha256:"artifact-sha",request_sha256:request};
 return {row,scope,op,artifact};
}
it("reads a separate validation without reopening the historical run or exposing raw response",async()=>{
 const f=await fixture(),net=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("FORBIDDEN_NETWORK"));
 const out=await savedResponseView(f.row,f.scope,f.op,f.artifact);
 expect(out).toMatchObject({run_status:"blocked",validation_status:"needs_review",human_validated:false,provider_calls:0});
 expect(f.scope.run_status).toBe("blocked");expect(JSON.stringify(out)).not.toContain("raw_response_text");expect(net).not.toHaveBeenCalled();net.mockRestore();
});
it.each(["stored_hash","receipt","tenant","run","attempt","request"])("rejects changed %s",async kind=>{
 const f=await fixture();
 if(kind==="stored_hash")f.row.body.changed=true;
 if(kind==="receipt")f.op.receipt.raw_response_text+=" changed";
 if(kind==="tenant")f.op.organization_id="another-org";
 if(kind==="run")f.artifact.source_run_id="another-run";
 if(kind==="attempt")f.op.request_count=2;
 if(kind==="request")f.artifact.request_sha256="another-request";
 await expect(savedResponseView(f.row,f.scope,f.op,f.artifact)).rejects.toThrow();
});
it("does not trust a rehashed result that differs from the real native receipt",async()=>{
 const f=await fixture(),r=f.row.body.result as Record<string,unknown>;
 r.usage={input_tokens:999,output_tokens:2};f.row.body.result_sha256=await hybridHash(r);f.row.sha256=await hybridHash(f.row.body);
 await expect(savedResponseView(f.row,f.scope,f.op,f.artifact)).rejects.toThrow("JLS_SAVED_RESPONSE_CHANGED");
});
it("reads versioned V2 and V1 separately, preserving source provenance",async()=>{
 const f=await fixture(),legacy=await savedResponseView(f.row,f.scope,f.op,f.artifact);
 f.row.body={...f.row.body,version:"jls-saved-response-validation-v2",finalization_version:"jls-received-finalization-v2",source_original_validation_id:legacy.id,source_original_validation_sha256:legacy.sha256};
 f.row.id="v2";f.row.sha256=await hybridHash(f.row.body);
 const current=await savedResponseView(f.row,f.scope,f.op,f.artifact);
 expect(current.id).toBe("v2");expect(current.source_original_validation_id).toBe(legacy.id);expect(legacy.revalidation_version).toBe("jls-saved-response-validation-v1");
 expect(current.result.validated_report).toEqual(legacy.result.validated_report);
});
it.each(["fr","vi"] as const)("%s clearly labels the saved-response validation and retains the blockage",async language=>{
 const f=await fixture(),view=await savedResponseView(f.row,f.scope,f.op,f.artifact);
 const data:RestaurantView={protocol:{id:"p",sha256:"a".repeat(64),created_at:"2026-10-17",establishment_name:"SYNTHETIC CHILL",source_sha256:"b".repeat(64),configuration_sha256:"c".repeat(64),
 coverage:{google_total:2745,stored_reviews:100,reviews_with_text:80,english_ready:80,reused_analyses:0,missing_analyses:80,missing_english:0},max_jev_calls:80,max_luna_calls:32,max_sol_calls:1,language:"vi",format_version:"jls-prioritized-recommendations-v2",editorial_version:"v2"},
 frozen_source:{establishment_id:"e",historical_run_id:"historical",source_fingerprint:"d".repeat(64),source_ids:[],statistics_denominators:{overall:100,thematic:80},no_paid_go:false,immutable_historical_report:true},
 run:{id:"run",stage:"validate_sol",status:"blocked",error_code:"SYNTHETIC_SAVE_BLOCKAGE"},progress:[],result:null,saved_response_validation:view};
 render(<I18nProvider language={language}><JlsRestaurantPreparation data={data}/></I18nProvider>);
 expect(screen.getByTestId("jls-saved-response")).toHaveTextContent("needs_review");expect(screen.getByTestId("jls-saved-response")).toHaveTextContent("synthetic_commit");
 expect(screen.getByRole("alert")).toHaveTextContent("SYNTHETIC_SAVE_BLOCKAGE");expect(screen.getByText("EXPLICIT SYNTHETIC REPORT RENDER")).toBeVisible();
});
