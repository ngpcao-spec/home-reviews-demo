// Opt-in bounded envelope. Historical 20k plans keep their identity.
import {localHybridTokens} from "./jev-hybrid-evidence.ts";
import {canonicalJson} from "./jev-exploratory-core.ts";
export const SOL_SIZE_POLICY=Object.freeze({version:"jls-sol-envelope-32k-v1",model:"gpt-6.1-sol",
 input_budget_tokens:32768,max_output_tokens:9500,model_context_tokens:1050000,
 model_max_output_tokens:128000,max_request_bytes:1048576,token_margin_ratio:0.12,
 framing_margin_tokens:256,provider_timeout_ms:110000,edge_min_wall_time_ms:150000,
 edge_memory_mb:256,automatic_retry:false,
 model_limits_source:"https://developers.openai.com/api/docs/models/gpt-6.1-sol",
 infrastructure_limits_source:"https://supabase.com/docs/guides/functions/limits",
 verified_on:"2026-10-15",account_access_and_quotas_verified:false});
export type SolSizePolicy=typeof SOL_SIZE_POLICY;
export function solRequestSize(request:unknown,policy:SolSizePolicy=SOL_SIZE_POLICY,count:(text:string)=>number=localHybridTokens) {
 if(canonicalJson(policy)!==canonicalJson(SOL_SIZE_POLICY))throw Error("JLS_SOL_SIZE_POLICY_CHANGED");
 const q=request as {model?:string;max_output_tokens?:number;input?:{role:string;content:string}[];text?:{format?:{schema?:unknown}}};
 if(q.model!==policy.model||q.max_output_tokens!==policy.max_output_tokens)throw Error("JLS_SOL_ENVELOPE_MODEL_OR_OUTPUT_CHANGED");
 const serialized=JSON.stringify(request),tokens=count(serialized),bytes=new TextEncoder().encode(serialized).length;
 const guarded=Math.ceil(tokens*(1+policy.token_margin_ratio))+policy.framing_margin_tokens;
 if(bytes>policy.max_request_bytes)throw Error("JLS_SOL_REQUEST_BYTES_EXCEEDED");
 if(guarded>policy.input_budget_tokens)throw Error("JLS_SOL_TOKEN_BUDGET_EXCEEDED");
 if(guarded+policy.max_output_tokens>policy.model_context_tokens||policy.max_output_tokens>policy.model_max_output_tokens)
  throw Error("JLS_SOL_CONTEXT_BUDGET_EXCEEDED");
 if(policy.provider_timeout_ms+30000>policy.edge_min_wall_time_ms)throw Error("JLS_SOL_INFRASTRUCTURE_TIMEOUT_INVALID");
 return {version:policy.version,request_bytes:bytes,local_input_tokens:tokens,guarded_input_tokens:guarded,
  margin_tokens:guarded-tokens,input_budget_tokens:policy.input_budget_tokens,input_headroom_tokens:policy.input_budget_tokens-guarded,
  output_reserved_tokens:policy.max_output_tokens,total_reserved_tokens:guarded+policy.max_output_tokens,model_context_tokens:policy.model_context_tokens,
  prompt_tokens:count(q.input?.find(x=>x.role==="system")?.content??""),
  dossier_tokens:count(q.input?.find(x=>x.role==="user")?.content??""),schema_tokens:count(JSON.stringify(q.text?.format?.schema??{})),
  tokenizer:"o200k_base",method:"serialized complete request; local estimate + 12% + 256 framing; not billed tokens"};
}
