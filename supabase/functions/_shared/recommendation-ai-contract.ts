import type {Proposal} from './restaurant-recommendation-engine-v1.ts';
export type AiSelection={proposal:Proposal;reasons:{ref:string;text:string;source:unknown}[];caution:{ref:string;text:string;source:unknown}|null};
export type Metrics={model:string|null;input_tokens:number|null;output_tokens:number|null;cache_read_tokens:number|null;cache_write_tokens:number|null;duration_ms:number;cost_usd:number|null;cost_kind:'provider_returned'|'unavailable';provider_request_id:string|null};
export type AiComparison={status:'completed'|'cached'|'fallback'|'pending';notice?:string;model:string;attempt_id?:string;candidate_count:number;selections:AiSelection[];metrics?:Metrics};
