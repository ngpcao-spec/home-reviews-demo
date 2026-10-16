// Read-only projection of the saved execution. Never prepares or wakes a job.
import {hybridHash} from "./jev-hybrid-evidence.ts";
import type {validateRecommendationReportV2} from "./jls-recommendation-contract-v2.ts";
type SavedReport=Awaited<ReturnType<typeof validateRecommendationReportV2>>;
export interface ContractViewProtocol {id:string;organization_id:string;establishment_id:string;sha256:string;}
export interface ContractViewOperation {
 id:string;protocol_id:string;organization_id:string;mode:string;status:string;phase:string;
 luna_count:number;sol_count:number;error_code:string|null;created_at:string;
 result:Record<string,unknown>|null;result_sha256:string|null;
 luna_result:Record<string,unknown>|null;luna_result_sha256:string|null;
}
export interface ContractReportView {
 id:string;protocol_id:string;protocol_sha256:string;result_sha256:string|null;created_at:string;
 establishment_id:string;establishment_name:string;status:string;phase:string;error_code:string|null;
 luna_count:number;sol_count:number;report:SavedReport|null;
 usage:{luna:unknown;sol:unknown};models:{luna:string|null;sol:string|null};
 costs:{luna:number|null;sol:number|null};
 human_validated:false;new_paid_calls:0;
}
export async function contractReportView(p:ContractViewProtocol,o:ContractViewOperation,
 scope:{organization_id:string;establishment_id:string;establishment_name:string}):Promise<ContractReportView> {
 if(p.organization_id!==scope.organization_id||p.establishment_id!==scope.establishment_id||
  o.organization_id!==scope.organization_id||o.protocol_id!==p.id||o.mode!=="paid")throw Error("FORBIDDEN");
 if(o.result!==null&&await hybridHash(o.result)!==o.result_sha256||
  o.luna_result!==null&&await hybridHash(o.luna_result)!==o.luna_result_sha256)throw Error("JLS_RESULT_CHANGED");
 const r=o.result?.validated_report as SavedReport|undefined;
 if(r&&(r.format_version!=="jls-prioritized-recommendations-v2"||r.language!=="vi"||r.human_validated!==false))throw Error("JLS_RESULT_CHANGED");
 const model=(v:unknown)=>typeof v==="string"?v:null,cost=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)?v:null;
 return {id:o.id,protocol_id:p.id,protocol_sha256:p.sha256,result_sha256:o.result_sha256,created_at:o.created_at,
  establishment_id:p.establishment_id,establishment_name:scope.establishment_name,status:o.status,phase:o.phase,error_code:o.error_code,
  luna_count:o.luna_count,sol_count:o.sol_count,report:r??null,
  usage:{luna:o.luna_result?.usage??null,sol:o.result?.usage??null},
  models:{luna:model(o.luna_result?.served_model),sol:model(o.result?.served_model)},
  costs:{luna:cost(o.luna_result?.cost_usd),sol:cost(o.result?.cost_usd)},human_validated:false,new_paid_calls:0};
}
