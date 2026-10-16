// Explicit synthetic saved-report fixture; never a provider response or reference.
import fixture from "../e2e/fixtures/jls-prioritized.json";
import type {ContractReportView,ContractViewProtocol,ContractViewOperation} from "../../supabase/functions/_shared/jls-contract-v2-view";
import {hybridHash} from "../../supabase/functions/_shared/jev-hybrid-evidence";
export function contractViewFixture():ContractReportView {
 const report={...structuredClone(fixture.views.vi.result),format_version:"jls-prioritized-recommendations-v2"};
 return {id:"synthetic-operation",protocol_id:"synthetic-protocol",protocol_sha256:"a".repeat(64),result_sha256:"b".repeat(64),
  created_at:"2026-10-16T00:00:00Z",establishment_id:"d40d3438-79d8-4c28-8b09-eba640598201",establishment_name:"SYNTHETIC V2 REPORT",
  status:"completed",phase:"validate_sol",error_code:null,luna_count:1,sol_count:1,
  report:report as unknown as NonNullable<ContractReportView["report"]>,usage:{luna:{input_tokens:10},sol:{input_tokens:100,output_tokens:20}},
  models:{luna:"gpt-6-luna",sol:"gpt-6.1-sol"},costs:{luna:null,sol:null},human_validated:false,new_paid_calls:0};
}
export async function contractReadRows(){
 const view=contractViewFixture(),scope={organization_id:"synthetic-org",establishment_id:view.establishment_id,establishment_name:view.establishment_name};
 const protocol:ContractViewProtocol={id:view.protocol_id,sha256:view.protocol_sha256,...scope};
 const result={validated_report:view.report,served_model:"gpt-6.1-sol",usage:view.usage.sol,cost_usd:null,
  raw_response_text:"EXPLICIT SYNTHETIC RAW RESPONSE NOT FOR PUBLIC PROJECTION"};
 const luna={served_model:"gpt-6-luna",usage:view.usage.luna};
 const operation:ContractViewOperation={id:view.id,protocol_id:view.protocol_id,organization_id:scope.organization_id,mode:"paid",status:view.status,
  phase:view.phase,luna_count:1,sol_count:1,error_code:null,created_at:view.created_at,result,result_sha256:await hybridHash(result),
  luna_result:luna,luna_result_sha256:await hybridHash(luna)};
 return {scope,protocol,operation};
}
