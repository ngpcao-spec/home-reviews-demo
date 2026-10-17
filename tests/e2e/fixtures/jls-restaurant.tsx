import {createRoot} from "react-dom/client";
import {I18nProvider} from "../../../src/i18n";
import {JlsRestaurantPreparation,type RestaurantView} from "../../../src/components/analysis/JlsRestaurantPreparation";
import reviewFixture from "./jls-recommendation-review.json";
import {contractViewFixture} from "../../fixtures/jls-contract-v2-view";
import "../../../src/styles/global.css";
import "../../../src/styles/pages.css";
import "../../../src/styles/warm-theme.css";
import "../../../src/pages/JevLunaSolPage.css";
const language=new URLSearchParams(location.search).get("language")==="vi"?"vi":"fr";
const ready=new URLSearchParams(location.search).has("ready");
const data:RestaurantView={protocol:{id:"11111111-1111-4111-8111-111111111111",sha256:"a".repeat(64),created_at:"2026-10-14",
 establishment_name:"Xóm Mới Garden",source_sha256:"b".repeat(64),configuration_sha256:"c".repeat(64),
 coverage:{google_total:17038,stored_reviews:587,reviews_with_text:550,english_ready:78,reused_analyses:78,missing_analyses:0,missing_english:472},
 max_jev_calls:0,max_luna_calls:ready?0:28,max_sol_calls:1,language:"vi",format_version:"jls-prioritized-recommendations-v1",
 sol_final_request_ready:ready,reused_luna_calls:ready?28:0,reused_luna_decisions:ready?32:0,
 prepared_artifact_sha256:"d".repeat(64),sol_preflight:{request_bytes:67867,local_input_tokens:19137,guarded_input_tokens:21690,input_budget_tokens:32768,output_reserved_tokens:9500,input_headroom_tokens:11078},
 editorial_version:"jls-prioritized-editorial-v1"},run:null,result:null,progress:null};
if(new URLSearchParams(location.search).has("review")){
 data.recommendation_review=reviewFixture.value as unknown as NonNullable<RestaurantView["recommendation_review"]>;
 data.result={validated_report:reviewFixture.original as unknown as NonNullable<NonNullable<RestaurantView["result"]>["validated_report"]>};
}
if(new URLSearchParams(location.search).has("contract-v2")){
 data.protocol=null;data.contract_v2=contractViewFixture();
}
if(new URLSearchParams(location.search).has("snapshot-v2")){
 data.protocol!.establishment_name="Chill Thái - Thai Food";
 data.protocol!.coverage={google_total:2745,stored_reviews:100,reviews_with_text:80,english_ready:80,reused_analyses:0,missing_analyses:80,missing_english:0};
 data.protocol!.max_jev_calls=80;data.protocol!.max_luna_calls=32;data.protocol!.format_version="jls-prioritized-recommendations-v2";
 data.frozen_source={establishment_id:"synthetic",historical_run_id:"synthetic-historical",source_fingerprint:"e".repeat(64),source_ids:[],statistics_denominators:{overall:100,thematic:80},no_paid_go:true,immutable_historical_report:true};
}
if(new URLSearchParams(location.search).has("saved-response")){
 data.run={id:"synthetic-run",stage:"validate_sol",status:"blocked",error_code:"SYNTHETIC_SAVE_BLOCKAGE"};
 data.saved_response_validation={id:"synthetic-saved-validation",sha256:"f".repeat(64),created_at:"2026-10-17",run_id:"synthetic-run",run_status:"blocked",operation_id:"synthetic-operation",
 validation_status:"needs_review",validator_version:"synthetic_validator",validator_code_provenance:"synthetic_commit",revalidation_version:"jls-saved-response-validation-v2",finalization_version:"jls-received-finalization-v2",source_original_validation_id:"synthetic-v1",source_receipt_sha256:"e".repeat(64),result_sha256:"d".repeat(64),human_validated:false,provider_calls:0,
 result:{validated_report:contractViewFixture().report!,input_tokens:10,output_tokens:2,duration_ms:5,served_model:"gpt-6.1-sol"}};
 const report=data.saved_response_validation.result.validated_report;
 Object.assign(report,{editorial_version:"SYNTHETIC_EDITORIAL"});
 const masked=structuredClone(report.report.recommendations[0]);
 Object.assign(masked,{title:"SYNTHETIC_MASKED_RECOMMENDATION",visible:false,status:"review_needed",reasons:["PRECISE_ACTION_REQUIRES_REVIEW"],priority:{...masked.priority,rank:2}});
 report.report.recommendations.push(masked);
}
createRoot(document.getElementById("root")!).render(<I18nProvider language={language}><main style={{padding:16,maxWidth:700,margin:"auto"}}><p>EXPLICIT SYNTHETIC TEST</p><JlsRestaurantPreparation data={data}/></main></I18nProvider>);
