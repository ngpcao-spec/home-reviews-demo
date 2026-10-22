// Private frozen exports in; new local measurements out. No database writes,
// provider credentials, annotation, report generation or modification of inputs.
// deno-lint-ignore no-import-prefix
import {z} from 'npm:zod@4.6.5';
import {prepareCompactSolWire,compactSolResponse,reconstructCompactSolResponse,verifyCompactSolWire} from '../supabase/functions/_shared/parallel-sol-wire.ts';
import {directHash,directCanonical} from '../supabase/functions/_shared/jev-direct-categories.ts';
import {analysisTextSha256} from '../supabase/functions/_shared/analysis-text.ts';
import {solRequestSize} from '../supabase/functions/_shared/jls-sol-size.ts';
import {validateParallelReport} from '../supabase/functions/_shared/parallel-report.ts';

globalThis.fetch=()=>{throw Error('PROVIDER_NETWORK_FORBIDDEN');};
const [input,expectedSha,output,derivative]=Deno.args;
if(!input||!/^[a-f0-9]{64}$/.test(expectedSha??'')||!output||input===output||derivative===output)throw Error('DISTINCT_PRIVATE_PATHS_AND_EXPECTED_SHA_REQUIRED');
const inputBytes=await Deno.readFile(input),archive=JSON.parse(new TextDecoder().decode(inputBytes)),b=archive.body,s=b.protocol.body.source;
if(archive.sha256!==expectedSha||await directHash(b)!==expectedSha)throw Error('SOURCE_ARCHIVE_CHANGED');
const template=b.protocol.body.ready_template,request=JSON.parse(template.request_json);
if(directCanonical(request)!==directCanonical(b.request)||
 await directHash(request)!==template.request_sha256||await analysisTextSha256(template.request_json)!==template.request_raw_sha256||
 b.execution.operation.receipt.request_sha256!==template.request_sha256||await analysisTextSha256(b.execution.operation.receipt.raw_response_text)!==b.execution.operation.receipt.raw_response_sha256)
 throw Error('RECORDED_REQUEST_OR_RECEIPT_CHANGED');
const rows=b.source_input.dataset.body.reviews;
const source={organization_id:b.organization_id,establishment_id:b.establishment_id,source_snapshot_sha256:await directHash(s.sources),
 statistics:s.statistics,statistics_sha256:s.statistics_sha256,evidence:s.selected,reviews:s.sources.map((r:Record<string,unknown>)=>{
  const d=rows.find((d:{review_id:string})=>d.review_id===r.id);
  return {...r,analysis_language:r.analysis_language??d?.analysis_language,analysis_source:r.analysis_source??d?.translation_source,translation_provenance:r.translation_provenance??d?.translation_provenance};
 })};
const wire=await prepareCompactSolWire(source,'vi'),schema=z.toJSONSchema(compactSolResponse);delete schema.$schema;
const compact={model:request.model,reasoning:request.reasoning,max_output_tokens:request.max_output_tokens,
 input:[{role:'system',content:wire.prompt},{role:'user',content:JSON.stringify(wire.packet)}],
 text:{format:{type:'json_schema',name:'jls_direct4_compact_sol_v1',strict:true,schema}}};
await verifyCompactSolWire(source,'vi',wire.manifest,wire.manifest_sha256,wire.packet);
// Exercise reconstruction for every association, without synthesizing any
// customer observation or claiming that these are new model responses.
for(const binding of wire.manifest.associations){
 const probe={format_version:wire.manifest.version,report:{categories:['service','price','quality','ambiance'].map(category=>({category,text:'TECHNICAL IDENTITY PROBE',refs:[]})),
  positive_aspects:[],negative_aspects:[],conclusion:{text:'TECHNICAL IDENTITY PROBE',refs:[binding.ref]},
  recommendations:[{category:binding.category,title:'TECHNICAL IDENTITY PROBE',refs:[binding.ref],observations:[{text:'TECHNICAL IDENTITY PROBE',ref:binding.ref}],proposed_action:'TECHNICAL IDENTITY PROBE',priority_reason:'TECHNICAL IDENTITY PROBE'}]}};
 const o=reconstructCompactSolResponse(probe,wire.manifest,source.evidence).report.recommendations[0].observations[0],e=source.evidence.find((e:{evidence_id:string})=>e.evidence_id===binding.evidence_id);
 if(o.evidence_id!==e.evidence_id||o.quote!==e.quote||o.quote_sha256!==e.quote_sha256)throw Error('QUOTE_RECONSTRUCTION_CHANGED');
}
let outputShape=null;
if(derivative){
 const legacy=JSON.parse(await Deno.readTextFile(derivative));
 const valid=await validateParallelReport(legacy,{evidence:source.evidence,statistics:source.statistics,statistics_sha256:source.statistics_sha256} as never);
 if(!valid.technical_checks_passed)throw Error('SAVED_DERIVATIVE_INVALID');
 const alias=(id:string)=>{const a=wire.manifest.associations.find(a=>a.evidence_id===id);if(!a)throw Error('UNKNOWN_SAVED_REFERENCE');return a.ref;};
 const pass=(p:{category:string;text:string;evidence_ids:string[]})=>({category:p.category,text:p.text,refs:p.evidence_ids.map(alias)});
 const r=legacy.report,short={format_version:wire.manifest.version,report:{categories:r.categories.map(pass),positive_aspects:r.positive_aspects.map(pass),negative_aspects:r.negative_aspects.map(pass),
  conclusion:{text:r.conclusion.text,refs:r.conclusion.evidence_ids.map(alias)},recommendations:r.recommendations.map((p:{title:string;category:string;evidence_ids:string[];observations:{text:string;evidence_id:string}[];proposed_action:string;priority_reason:string})=>({
   title:p.title,category:p.category,refs:p.evidence_ids.map(alias),observations:p.observations.map(o=>({text:o.text,ref:alias(o.evidence_id)})),proposed_action:p.proposed_action,priority_reason:p.priority_reason}))}};
 const expanded=reconstructCompactSolResponse(short,wire.manifest,source.evidence);
 if(directCanonical(expanded)!==directCanonical(legacy))throw Error('ROUNDTRIP_CHANGED_SAVED_REPORT');
 // Token counts for identical SAVED prose in two output shapes. These are not
 // predictions of the length/quality of a future Sol response or its reasoning.
 const {localHybridTokens}=await import('../supabase/functions/_shared/jev-hybrid-evidence.ts');
 outputShape={method:'offline encoding of identical saved derived prose; not a generated output or billed/reasoning usage',
  before_chars:JSON.stringify(legacy).length,after_chars:JSON.stringify(short).length,before_tokens:localHybridTokens(JSON.stringify(legacy)),after_tokens:localHybridTokens(JSON.stringify(short)),
  roundtrip_identical:true,saved_report_sha256:await directHash(legacy)};
}
const before=solRequestSize(request),after=solRequestSize(compact),sourcePacket=JSON.parse(request.input[1].content);
const evidence={version:wire.manifest.version,source_archive_sha256:expectedSha,request_sha256:template.request_sha256,compact_request_sha256:await directHash(compact),
 provider_calls:0,new_runs:0,new_consents:0,model:compact.model,reasoning:compact.reasoning,
 before:{user_chars:request.input[1].content.length,system_chars:request.input[0].content.length,schema_chars:JSON.stringify(request.text.format.schema).length,...before},
 after:{user_chars:compact.input[1].content.length,system_chars:wire.prompt.length,schema_chars:JSON.stringify(schema).length,...after},
 preservation:{distinct_reviews:wire.packet.reviews.length,associations:wire.packet.associations.length,
  repeated_review_occurrences_removed:sourcePacket.evidence.length-wire.packet.reviews.length,identical_originals_omitted:sourcePacket.original_reviews.length-wire.packet.reviews.filter(r=>'original' in r).length,
  different_originals_retained:wire.packet.reviews.filter(r=>'original' in r).length,quotes_reconstructed:wire.manifest.associations.length,
  mapping_sha256:wire.manifest_sha256,source_texts_unchanged:true,server_statistics_unchanged:true},
 input_token_reduction_percent:100*(before.local_input_tokens-after.local_input_tokens)/before.local_input_tokens,output_shape:outputShape,
 limitation:'o200k_base local tokenizer estimate for the gpt-6.1-sol alias, schema included; no provider token-count request; 12% + 256 token margin, not billed usage or quality validation'};
if(await analysisTextSha256(new TextDecoder().decode(await Deno.readFile(input)))!==await analysisTextSha256(new TextDecoder().decode(inputBytes)))throw Error('INPUT_CHANGED');
await Deno.writeTextFile(output,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
