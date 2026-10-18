// Explicit synthetic UI fixture, never a provider result or AI reference.
import {contractViewFixture} from "./jls-contract-v2-view";
import type {ServiceReviewView} from "../../supabase/functions/_shared/jls-service-review-v21";
export function serviceReviewFixture():ServiceReviewView{
 const validation=contractViewFixture().report!;
 Object.assign(validation,{validator_version:"jls-reservation-beverage-validation-v2.1",editorial_version:"jls-recommendation-contract-v2.1",raw_response_sha256:"c".repeat(64)});
 return {id:"SYNTHETIC_SERVICE_REVIEW",sha256:"a".repeat(64),version:"jls-reservation-beverage-review-v2.1",code_provenance:"synthetic_commit",
  source_saved_validation_id:"synthetic-saved-validation",content_unchanged:true,validation:validation as ServiceReviewView["validation"],
  changes:[{index:0,rank:1,title:"SYNTHETIC_BOOKING_CLARIFICATION",old_status:"review_needed",old_visible:false,new_status:"technically_bound_proposal",new_visible:true,reasons:[]},
   {index:1,rank:2,title:"SYNTHETIC_BEVERAGE_DELAY",old_status:"review_needed",old_visible:false,new_status:"review_needed",new_visible:false,reasons:["BEVERAGE_DELAY_REQUIRES_WAIT_TIME_EVIDENCE"]}],
  compatible_accepted_beverage_wait_ids:[],missing_beverage_wait_proof:true,candidates:[],
  future_preparation:{contract:"jls-recommendation-contract-v2.1",prompt_sha256:"b".repeat(64),requires_new_protocol:true},provider_calls:0,human_validated:false};
}
