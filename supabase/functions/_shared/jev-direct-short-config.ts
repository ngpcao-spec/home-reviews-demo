// Transport identity only: questions are copied exactly from the frozen common prompt.
import {SHORT_CONFIG,shortJev} from './direct4-short-comparison.ts';
import {DIRECT_CONFIG} from './jev-direct-categories.ts';
export const SHORT_FROZEN_DIRECT4='jls-direct4-short-frozen-corpus-v1';
export const SHORT_CLASSIFIER_CONFIG=Object.freeze({id:'jev_categories4_short_common_1pass_v1',
 source_common_archive:'97380a66-200d-4b9f-90d2-5039fb6c3ddc',
 common_configuration:SHORT_CONFIG,common_configuration_sha256:'14c20d5525a70b200a711a41ae5e281ea64eaac910196d0a733bed64701930e3',
 requested_model:'jev-1.13.0',questions:shortJev({review_alias:'unused',analysis_text:'unused'}).questions,
 parser_version:DIRECT_CONFIG.parser_version,repeat_count:1,automatic_retry:false,confidence_threshold:null,production_enabled:false});
export const frozenDirect4Version=(v:string)=>v==='jls-direct4-frozen-corpus-v1'||v===SHORT_FROZEN_DIRECT4;
export const historicalClassifier=(v:string)=>v===SHORT_FROZEN_DIRECT4?SHORT_CLASSIFIER_CONFIG:DIRECT_CONFIG;
