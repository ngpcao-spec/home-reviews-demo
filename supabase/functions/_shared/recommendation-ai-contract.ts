import type {Proposal,Request as EngineRequest} from './restaurant-recommendation-engine-v1.ts';
export type ExplanationSource=
 |{kind:'report';report_id:string;generated_at:string;section:'positive_aspects'|'reservations';index:number;category:string;text:string;evidence_ids:string[]}
 |{kind:'google_maps';observed_at:string|null;field:string;label:string;value:boolean;url:string|null}
 |{kind:'internal_score';report_id:string;generated_at:string;category:string;score:string};
export type CautionContext={kind:'uncertainty'|'context_limit'|'documented_issue'|'freshness';criterion_keys:string[]};
export type AiExplanation={ref:string;text:string;source:unknown;display_kind?:'report_extract'|'google_declaration'|'internal_score'|'saved_metadata'|'source_unavailable'|'derived_observation';sources?:ExplanationSource[];notes?:('google_not_noise_measurement'|'recurrence_requires_source_check'|'source_unavailable'|'derived_observation')[];caution_context?:CautionContext};
export type CriterionState='documented'|'partial'|'contradicted'|'conflicted'|'unknown';
export type CriterionCoverage={criterion:string;label:string;request_span:{start:number;end:number};key:string|null;requirement:'preference'|'mandatory_filter';state:CriterionState;evidence:AiExplanation[]};
export type AiAlternative={proposal:Proposal;coverage:CriterionCoverage[]};
export type AiSelection={proposal:Proposal;reasons:AiExplanation[];caution:AiExplanation|null;coverage?:CriterionCoverage[];cautions?:AiExplanation[];other_limits?:AiExplanation[];alternatives?:AiAlternative[];match?:'documented'|'partial'};
export type Metrics={model:string|null;input_tokens:number|null;output_tokens:number|null;cache_read_tokens:number|null;cache_write_tokens:number|null;duration_ms:number;cost_usd:number|null;cost_kind:'provider_returned'|'unavailable';provider_request_id:string|null;configuration_version?:string;content_version?:string};
export type FallbackDisclosure={version:'recommendation-fallback-disclosure-v1';personalized_choice_available:false;free_text:'not_verified'|'not_requested';verified:{access:boolean;report_and_scores:boolean;cuisines:string[];budget:EngineRequest['budget']|null;required_features:string[];geography:'not_requested'|'filtered';service_priority:boolean};assessments:{establishment_id:string;coverage:CriterionCoverage[]}[]};
export type AiComparison={status:'completed'|'cached'|'fallback'|'pending';notice?:string;model:string;attempt_id?:string;candidate_count:number;selections:AiSelection[];metrics?:Metrics;fallback?:FallbackDisclosure};
