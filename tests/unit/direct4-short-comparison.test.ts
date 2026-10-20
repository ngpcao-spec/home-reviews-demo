import {it,expect,vi} from 'vitest';
import {SHORT_CONFIG,SHORT_SCOPES,SHORT_CHOICES,SHORT_RULES,shortInstructions,shortJev,shortLuna,shortContract,parseShortJev,verifyShortComparison,type ShortBody} from '../../supabase/functions/_shared/direct4-short-comparison';
import {DIRECT_CATEGORY_KEYS,DIRECT_NATIVE_CHOICES,directHash,parseDirectCategoriesRounded,DIRECT_CONFIG} from '../../supabase/functions/_shared/jev-direct-categories';
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text';
import {processRestaurant,type RestaurantState,type RestaurantPort} from '../../supabase/functions/_shared/jls-restaurant-worker';
const raw=(model='jev-1.13.0',choice='mixed',confidence=.01)=>{
 const one={type:'choice',choice,confidence,probabilities:Object.fromEntries(DIRECT_NATIVE_CHOICES.map(k=>[k,k===choice?1:0]))};
 return {model,usage:{input_tokens:10,output_tokens:0,total_tokens:10},answers:model==='gpt-6-luna'?
 DIRECT_CATEGORY_KEYS.map(name=>({...one,name,probabilities:DIRECT_NATIVE_CHOICES.map(value=>({value,probability:value===choice?1:0}))})):
 Object.fromEntries(DIRECT_CATEGORY_KEYS.map(k=>[k,one]))};
};
async function fixture(){
 const configuration_sha256=await directHash(SHORT_CONFIG),items=[];
 for(let n=0;n<87;n++){
 const text='EXPLICIT SYNTHETIC source '+n,base={review_alias:'S'+n,analysis_text:text},jev_request=shortJev(base),luna_request=shortLuna(base);
 items.push({...base,review_id:'r'+n,analysis_text_sha256:await analysisTextSha256(text),original_text:text,original_text_sha256:await analysisTextSha256(text),
 translation_provenance:{explicit_mock:true},rating:5,jev:{task_id:'old',artifact_sha256:'old',request_sha256:'old',served_model:'jev-1.13.0',usage:null,categories:parseDirectCategoriesRounded(raw('jev-1.13.0','positive')).categories},
 baseline_luna:{task_id:'oldL',artifact_sha256:'oldL',served_model:'gpt-6-luna',usage:null,categories:parseDirectCategoriesRounded(raw('jev-1.13.0','positive')).categories},
 jev_request,luna_request,jev_request_sha256:await directHash(jev_request),luna_request_sha256:await directHash(luna_request)});
 }
 const body:ShortBody={version:SHORT_CONFIG.version,organization_id:'o',establishment_id:'e',authority_user_id:'u',source_archive_id:'a',source_archive_sha256:'a',source_protocol_id:'p',source_snapshot_sha256:'s',
 configuration:SHORT_CONFIG,configuration_sha256,items,pending:items.map(i=>({review_id:i.review_id,request_sha256:i.jev_request_sha256,identity:{expected_served_model:'jev-1.13.0',configuration_sha256}})),
 max_jev_calls:87,max_luna_calls:87,max_sol_calls:0,production_enabled:false,code_provenance:'mock',preparation_is_not_spending_authorization:true,corpus_previously_examined:true,not_new_independent_validation:true};
 const state:RestaurantState={protocol:{id:'p',body:body as never,sha256:await directHash(body)},run:{id:'run',stage:'jev',status:'queued'},tasks:items.map((i,n)=>({id:'j'+n,run_id:'run',organization_id:'o',phase:'jev',review_id:i.review_id,request:i.jev_request,request_sha256:i.jev_request_sha256,identity:body.pending[n].identity,cache_id:null,status:'pending',request_count:0,worker:''})),artifacts:[]};
 let go=true,leased=false,receiptWrites=0;const intents=new Set<string>(),receipts=new Map<string,{status:string;body:Record<string,unknown>;sha256:string}>();
 const finish=async(id:string,status:string,b:unknown,sha:string)=>{
 const t=state.tasks.find(t=>t.id===id)!;if(t.status===status)return true;t.status=status;
 state.artifacts.push({kind:'task:'+id,body:b as Record<string,unknown>,sha256:sha});if(status!=='completed')state.run.status='blocked';return true;};
 const port:RestaurantPort={load:async()=>state,cache:async()=>{throw Error('NO_CACHE_RECLASSIFICATION');},
 tick:async()=>{if(!go||leased||!['queued','running'].includes(state.run.status))return false;leased=true;state.run.status='running';return true;},
 claim:async(_r,w)=>{const t=state.tasks.find(t=>t.phase===state.run.stage&&t.status==='pending'&&t.request_count===0);if(!t)return null;t.status='running';t.request_count=1;t.worker=w;return structuredClone(t);},
 beginProvider:async(t)=>{if(intents.has(t.id))return false;intents.add(t.id);return true;},
 retainReceipt:async(_s,t,o)=>{receiptWrites++;receipts.set(t.id,o);return true;},
 finishReceipt:async id=>{const o=receipts.get(id)!;return finish(id,o.status,o.body,o.sha256);},
 finish:async(id,_w,status,b,sha)=>finish(id,status,b,sha),
 artifact:async(_r,_w,kind,b,sha)=>{const old=state.artifacts.find(a=>a.kind===kind);if(old)return old.sha256===sha;state.artifacts.push({kind,body:b as Record<string,unknown>,sha256:sha});return true;},
 stage:async(_r,_w,stage,tasks)=>{
 if(stage==='completed'){state.run.status='completed';return true;}if(stage!=='luna')throw Error('SOL_FORBIDDEN');state.run.stage='luna';
 for(const x of tasks as {review_id:string;request:unknown;request_sha256:string}[])state.tasks.push({id:'l'+x.review_id,run_id:'run',organization_id:'o',phase:'luna',review_id:x.review_id,request:x.request,request_sha256:x.request_sha256,identity:null,cache_id:null,status:'pending',request_count:0,worker:''});return true;},
 release:async(_r,_w,error)=>{leased=false;if(error)state.run.status='blocked';}};
 const mock:typeof fetch=async(url,init)=>{
 const q=JSON.parse(String(init?.body));if(String(url).endsWith('/systemone')){expect(q.model).toBe('jev-1.13.0');expect(Object.keys(q.state).sort()).toEqual(['analysis_text','review_alias']);}
 else{expect(String(url)).toBe('https://api.openai.com/v1/decisions');expect(Object.keys(JSON.parse(q.input)).sort()).toEqual(['analysis_text','review_alias']);}
 expect(init?.redirect).toBe('error');return new Response(JSON.stringify(raw(q.model)));
 };
 return {state,body,port,mock,deny:()=>{go=false;},intents,receipts,receiptWrites:()=>receiptWrites};
}
it('uses the exact short business definitions, six choices and common content for both APIs; no former rules or examples',async()=>{
 expect(await directHash(DIRECT_CONFIG)).toBe('e5995c6e4b3a8f5949cbcde2531180ad3af503e50ee38b1b7674fceed561fe69');
 expect(SHORT_SCOPES.ambiance).toBe('cadre, décoration, musique, bruit, confort, propreté et vue depuis le restaurant');
 expect(SHORT_RULES).not.toMatch(/V12|CATEGORY BOUNDARIES|Good service|steak|VIP|80s|Foursea/);
 const i={review_alias:'R',analysis_text:'EXPLICIT SYNTHETIC'},j=shortJev(i),l=shortLuna(i);
 for(const q of l.questions){expect(q.instructions).toBe(j.questions[q.name].instructions);expect(q.instructions).toBe(shortInstructions(q.name));expect(q.choices).toEqual(DIRECT_NATIVE_CHOICES.map(value=>({value,description:SHORT_CHOICES[value]})));}
 expect(JSON.parse(l.input)).toEqual(j.state);expect(Object.keys(l)).toEqual(['model','input','questions']);expect(Object.keys(j)).toEqual(['model','state','questions']);
});
it.each(DIRECT_NATIVE_CHOICES)('keeps native JEV %s and confidence zero without filtering or normalizing',choice=>{
 const r=raw('jev-1.13.0',choice,0),before=JSON.stringify(r),p=parseShortJev(r);expect(p.categories.quality.native_choice).toBe(choice);expect(p.categories.quality.native_confidence).toBe(0);expect(JSON.stringify(r)).toBe(before);
});
it('rejects a different served model without a fallback request',()=>expect(()=>parseShortJev(raw('another'))).toThrow());
it('rehearses all 174 calls with concurrency, immutable receipts, complete comparison, changes from old prompts and repeated wakes',async()=>{
 const f=await fixture(),http=vi.fn(f.mock),contract=shortContract();
 for(let n=0;n<24&&f.state.run.status!=='completed';n++)await Promise.all([processRestaurant(f.port,'run',{jev:'mock',openai:'mock'},http,contract),processRestaurant(f.port,'run',{jev:'mock',openai:'mock'},http,contract)]);
 expect(f.state.run.status).toBe('completed');expect(http).toHaveBeenCalledTimes(174);expect(f.intents.size).toBe(174);expect(f.receipts.size).toBe(174);expect(f.state.tasks.every(t=>t.request_count===1)).toBe(true);
 const b=f.state.artifacts.find(a=>a.kind==='short_common_classification_comparison')!.body;
 expect(b.total_cells).toBe(348);expect(b.change_counts).toEqual({jev:348,luna:348});expect(b.agreements).toBe(348);
 await processRestaurant(f.port,'run',{jev:'mock',openai:'mock'},http,contract);expect(http).toHaveBeenCalledTimes(174);
});
it.each(['timeout','429','500','invalid_json','wrong_model','missing_usage'])('preserves %s and never resends an uncertain attempt',async kind=>{
 const f=await fixture(),http=vi.fn(async()=>{if(kind==='timeout')throw Error('EXPLICIT_MOCK_TIMEOUT');if(kind==='invalid_json')return new Response('bad');
 const r=raw(kind==='wrong_model'?'other':'jev-1.13.0');if(kind==='missing_usage')delete (r as {usage?:unknown}).usage;return new Response(JSON.stringify(r),{status:kind==='429'?429:kind==='500'?500:200});});
 await processRestaurant(f.port,'run',{jev:'mock',openai:'mock'},http,shortContract());await processRestaurant(f.port,'run',{jev:'mock',openai:'mock'},http,shortContract());
 expect(http).toHaveBeenCalledTimes(8);expect(f.state.run.status).toBe('blocked');expect(f.receipts.size).toBe(8);
});
it('blocks absent GO and a changed frozen instruction or source before any request',async()=>{
 const f=await fixture(),http=vi.fn(f.mock);f.deny();await processRestaurant(f.port,'run',{jev:'mock',openai:'mock'},http,shortContract());expect(http).not.toHaveBeenCalled();
 const g=await fixture();g.body.items[0].analysis_text='changed';await expect(verifyShortComparison(g.body,g.state.protocol.sha256)).rejects.toThrow();
 await processRestaurant(g.port,'run',{jev:'mock',openai:'mock'},http,shortContract());expect(http).not.toHaveBeenCalled();
});
