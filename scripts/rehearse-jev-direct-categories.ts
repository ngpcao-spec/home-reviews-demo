// Technical replay of the real frozen payloads with synthetic outputs unrelated
// to their text. No AI annotation or semantic evaluation is performed.
import {DIRECT_CATEGORY_KEYS,DIRECT_NATIVE_CHOICES,directCategoryCounts,directHash,type DirectCountRow} from '../supabase/functions/_shared/jev-direct-categories.ts';
import {verifyDirectCategoriesProtocol,type DirectCategoriesProtocol} from '../supabase/functions/_shared/jev-direct-categories-preparation.ts';
import {evaluateDirectCategoriesOnce,type DirectOncePort} from '../supabase/functions/_shared/jev-direct-categories-once.ts';
globalThis.fetch=()=>{throw Error('ALL_PROVIDER_NETWORK_FORBIDDEN');};
const [path,output]=Deno.args,p:DirectCategoriesProtocol=JSON.parse(await Deno.readTextFile(path));
await verifyDirectCategoriesProtocol(p);
const consumed=new Set<string>(),receipts=new Map<string,Record<string,unknown>>(),rows:DirectCountRow[]=[];
let mockCalls=0;
const port:DirectOncePort={assertAuthorized:async()=>{/* Explicit in-memory test permission, no real consent. */},
 reserve:async(review_id,request_sha256,configuration_sha256)=>{if(consumed.has(review_id))return null;consumed.add(review_id);
  return {id:'EXPLICIT_TECHNICAL_MOCK_'+review_id,review_id,request_sha256,configuration_sha256,request_count:1};},
 saveReceipt:async body=>{receipts.set(String(body.review_id),body);return 'EXPLICIT_MOCK_RECEIPT_'+body.review_id;},
 saveResult:async body=>{if(!receipts.has(String(body.review_id)))throw Error('RAW_NOT_SAVED_FIRST');
  const result=body.result as DirectCountRow['result'];if(!result)throw Error('MOCK_PARSING_FAILED');
  rows.push({review_id:String(body.review_id),result});return 'EXPLICIT_MOCK_RESULT_'+body.review_id;}};
const transport:typeof fetch=async(_url,init)=>{
 mockCalls++;const q=JSON.parse(String(init?.body));
 if(init?.method!=='POST'||init.redirect!=='error'||Object.keys(q.state).sort().join()!=='analysis_text,review_alias'||
  Object.keys(q.questions).sort().join()!==[...DIRECT_CATEGORY_KEYS].sort().join())throw Error('MOCK_WIRE_INVALID');
 const choice=DIRECT_NATIVE_CHOICES[(mockCalls-1)%DIRECT_NATIVE_CHOICES.length];
 return new Response(JSON.stringify({model:'jev-explicit-technical-mock',usage:{input_tokens:1,output_tokens:0},
  answers:Object.fromEntries(DIRECT_CATEGORY_KEYS.map(k=>[k,{type:'choice',choice,
   probabilities:Object.fromEntries(DIRECT_NATIVE_CHOICES.map(c=>[c,c===choice?1:0]))}]))}));
};
for(const r of p.body.reviews)await evaluateDirectCategoriesOnce(p,r.review_id,port,'EXPLICIT_TECHNICAL_MOCK_KEY',transport);
for(const r of p.body.reviews)await evaluateDirectCategoriesOnce(p,r.review_id,port,'EXPLICIT_TECHNICAL_MOCK_KEY',transport);
const counts=directCategoryCounts(p.body.reviews.map(r=>r.review_id),rows);
if(mockCalls!==80||receipts.size!==80||rows.length!==80||counts.total_reviews!==80||
 Object.values(counts.categories).some(c=>Object.values(c.exclusive).reduce((a,b)=>a+b,0)!==80))throw Error('MOCK_COUNT_OR_RETRY_FAILED');
const body={version:'jev-direct-categories4-offline-qualification-v1',protocol_sha256:p.sha256,configuration_sha256:p.body.configuration_sha256,
 explicit_technical_mock_not_predictions:true,provider_network_denied:true,provider_calls:0,source_reviews_verified:80,
 questions_per_request:4,questions_verified:320,mock_http_invocations:mockCalls,one_attempt_per_review_verified:true,
 repeated_wakes_additional_dispatches:0,raw_receipts_saved_before_parsing:true,counter_invariants_passed:true,
 synthetic_counter_sha256:await directHash(counts),no_supabase_classification_results_written:true,
 consent_created:false,paid_run_created:false,production_changed:false,runtime:Deno.version};
await Deno.writeTextFile(output,JSON.stringify({body,sha256:await directHash(body)}));console.log(JSON.stringify(body));
