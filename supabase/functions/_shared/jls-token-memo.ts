// Per-plan deterministic token memo. Never shared between organisations/jobs.
import {localHybridTokens,hybridHash} from "./jev-hybrid-evidence.ts";
import {negativeHash} from "./negative-validation-core.ts";
export const TOKEN_CERT_VERSION="jls-o200k-frozen-measurements-v1";
export interface TokenCertificate {version:string;entries:{text:string;sha256:string;tokens:number}[]}
export class PlanTokenMemo {
 readonly entries=new Map<string,number>();misses=0;sealed=false;
 count=(text:string)=>{const hit=this.entries.get(text);if(hit!==undefined)return hit;if(this.sealed)throw Error("JLS_TOKEN_MEASUREMENT_MISSING");this.misses++;const n=localHybridTokens(text);
  if(this.entries.size>=128||text.length>1048576)throw Error("JLS_TOKEN_MEMO_CAPACITY_EXCEEDED");this.entries.set(text,n);return n;};
}
const plans=new WeakMap<object,PlanTokenMemo>();
export function planTokenMemo(plan:object){return plans.get(plan);}
export function planTokens(plan:object,text:string){return plans.get(plan)?.count(text)??localHybridTokens(text);}
export async function attachPlanTokenMemo(plan:object,certificate?:TokenCertificate,sealed=false){
 const memo=new PlanTokenMemo();if(certificate){
 if(certificate.version!==TOKEN_CERT_VERSION||certificate.entries.length>128)throw Error("JLS_TOKEN_CERTIFICATE_CHANGED");
 for(const e of certificate.entries){if(!Number.isSafeInteger(e.tokens)||e.tokens<0||e.text.length>1048576||await negativeHash(e.text)!==e.sha256||memo.entries.has(e.text))throw Error("JLS_TOKEN_CERTIFICATE_CHANGED");memo.entries.set(e.text,e.tokens);}}
 memo.sealed=sealed;plans.set(plan,memo);return memo;
}
export async function tokenCertificate(plan:object):Promise<TokenCertificate>{const m=plans.get(plan);if(!m)throw Error("JLS_TOKEN_MEMO_MISSING");
 return {version:TOKEN_CERT_VERSION,entries:await Promise.all([...m.entries].map(async([text,tokens])=>({text,tokens,sha256:await negativeHash(text)})))};}
export const tokenCertificateHash=(c:TokenCertificate)=>hybridHash(c);
