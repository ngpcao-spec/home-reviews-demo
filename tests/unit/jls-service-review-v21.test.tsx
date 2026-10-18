import {it,expect,afterEach} from "vitest";
import {render,screen,cleanup} from "@testing-library/react";
import {serviceReviewFixture} from "../fixtures/jls-service-review-v21";
import {JlsServiceReviewV21} from "../../src/components/analysis/JlsServiceReviewV21";
import {I18nProvider} from "../../src/i18n";
import {serviceReviewView,SERVICE_REVIEW_V21} from "../../supabase/functions/_shared/jls-service-review-v21";
import {hybridHash} from "../../supabase/functions/_shared/jev-hybrid-evidence";
import type {SavedResponseView,SavedResponseRow} from "../../supabase/functions/_shared/jls-saved-response-view";
afterEach(cleanup);
async function rows(){
 const f=serviceReviewFixture(),source={id:"source",sha256:"a".repeat(64),run_id:"run",operation_id:"operation",result_sha256:"b".repeat(64),source_receipt_sha256:"d".repeat(64),result:{validated_report:structuredClone(f.validation)}} as SavedResponseView;
 const body={...f,version:SERVICE_REVIEW_V21,source_run_id:source.run_id,source_operation_id:source.operation_id,
  source_saved_validation_id:source.id,source_saved_validation_sha256:source.sha256,source_result_sha256:source.result_sha256,
  source_receipt_sha256:source.source_receipt_sha256,source_report_sha256:f.validation.raw_response_sha256,
  validation_sha256:await hybridHash(f.validation),new_consent:false,new_paid_run:false};
 const row:SavedResponseRow={id:"review",organization_id:"org",body,sha256:await hybridHash(body),created_at:"synthetic"};
 return {row,source};
}
it("reads a new validation separately without changing its saved source",async()=>{
 const {row,source}=await rows(),before=await hybridHash(source),v=await serviceReviewView(row,source,"org");
 expect(v.id).toBe("review");expect(v.content_unchanged).toBe(true);expect(await hybridHash(source)).toBe(before);
});
it.each(["tenant","source","receipt","hash","raw"])("rejects changed %s",async kind=>{
 const {row,source}=await rows();
 if(kind==="tenant")row.organization_id="another-org";
 if(kind==="source")row.body.source_saved_validation_id="other-source";
 if(kind==="receipt")row.body.source_receipt_sha256="other-receipt";
 if(kind==="hash")row.body.changed=true;
 if(kind==="raw"){
  const v=row.body.validation as Record<string,unknown>;v.raw_response_sha256="e".repeat(64);
  row.body.source_report_sha256=v.raw_response_sha256;row.body.validation_sha256=await hybridHash(v);row.sha256=await hybridHash(row.body);
 }
 await expect(serviceReviewView(row,source,"org")).rejects.toThrow();
});
it.each(["fr","vi"] as const)("%s separates unchanged content, new validation and missing proof",language=>{
 render(<I18nProvider language={language}><JlsServiceReviewV21 value={serviceReviewFixture()}/></I18nProvider>);
 expect(screen.getByTestId("jls-service-review-v21")).toHaveTextContent("SYNTHETIC_BOOKING_CLARIFICATION");
 expect(screen.getByTestId("jls-service-review-v21")).toHaveTextContent("BEVERAGE_DELAY_REQUIRES_WAIT_TIME_EVIDENCE");
 expect(screen.getByRole("note")).toHaveTextContent("wait_time");expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
