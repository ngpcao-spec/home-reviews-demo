import {it,expect,beforeAll,afterAll,vi} from 'vitest';
import frozen from '../fixtures/chill-audit-boundaries-v22.json';
import {AUDIT_ECONOMY_CONFIG,AUDIT_ECONOMY_ID,AUDIT_QUESTION_SET,auditEconomyPayload,auditEconomyIdentity,auditBoundaryManifest} from '../../supabase/functions/_shared/jev-audit-boundaries-v22';
import {ECONOMY_CONFIG} from '../../supabase/functions/_shared/jev-economy-config';
import {economyIdentity,economyCacheKey} from '../../supabase/functions/_shared/jev-economy-cache';
import {negativeHash} from '../../supabase/functions/_shared/negative-validation-core';
import {portionBoundary,requestedCustomizationSignal,commercialCommunicationSignal,parkingFeeSignal,genericCoordinationOnly,auditCandidateSpans,auditBoundaryQuestions,refineAuditBoundaryEvidence,prepareAuditEvidenceReview} from '../../supabase/functions/_shared/jls-audit-boundaries-v22';
import {buildRecommendationDraftV22,validateRecommendationReportV22,CONTRACT_V22} from '../../supabase/functions/_shared/jls-recommendation-contract-v22';
import {buildRecommendationDraftV21} from '../../supabase/functions/_shared/jls-recommendation-contract-v21';
import {prioritizedFixture} from '../fixtures/jev-luna-sol-prioritized';
import {structuralRecommendationRevision} from '../../supabase/functions/_shared/jls-recommendation-review-v2';
import {hybridHash} from '../../supabase/functions/_shared/jev-hybrid-evidence';
let net:ReturnType<typeof vi.spyOn>;
beforeAll(()=>{net=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('PROVIDER_NETWORK_FORBIDDEN'));});
afterAll(()=>{expect(net).not.toHaveBeenCalled();net.mockRestore();});
const real=(prefix:string)=>frozen.reviews.find(r=>r.review_id.startsWith(prefix))!.analysis_text;
it('frozen real-text inputs match their historical SHA256; these are not new reference labels',async()=>{
 for(const r of frozen.reviews)expect(await negativeHash(r.analysis_text)).toBe(r.analysis_text_sha256);
});
it('new prompt identity retains 25 themes, polarities, thresholds, full attention and professionalism definitions',async()=>{
 expect(Object.keys(AUDIT_ECONOMY_CONFIG.questions)).toEqual(Object.keys(ECONOMY_CONFIG.questions));
 expect(AUDIT_ECONOMY_CONFIG.thresholds).toEqual(ECONOMY_CONFIG.thresholds);
 for(const k of ['attentiveness','professionalism'])expect(AUDIT_ECONOMY_CONFIG.questions[k]).toEqual(ECONOMY_CONFIG.questions[k]);
 expect(AUDIT_ECONOMY_CONFIG).toMatchObject({id:AUDIT_ECONOMY_ID,question_set:AUDIT_QUESTION_SET,repeat_count:1,paid_enabled:false,production_enabled:false});
 const q=AUDIT_ECONOMY_CONFIG.questions.coordination as {instructions:string};
 expect(q.instructions).not.toContain('Explicit "excellent service" or "good service" can express positive coordination');
 expect(q.instructions).toContain('ALONE does not establish');
 expect((await auditBoundaryManifest()).spending_authorization).toBeNull();
});
it('request state contains only alias and English analysis text; old and new cache keys never collide',async()=>{
 const p=auditEconomyPayload('r','Synthetic English review.');expect(Object.keys(p.state)).toEqual(['review_alias','analysis_text']);
 const old=await economyIdentity('o','e','r','Synthetic English review.','jev-1.13.0'),next=await auditEconomyIdentity('o','e','r','Synthetic English review.','jev-1.13.0');
 expect(await economyCacheKey(old)).not.toBe(await economyCacheKey(next));expect(next.threshold_sha256).toBe(old.threshold_sha256);
 expect(()=>auditEconomyPayload('r',' ')).toThrow();
});
it('rule regression: a small pot rim and customer overordering do not establish food quantity complaints',()=>{
 expect(portionBoundary(real('a3acf')).exclude_portion_inference).toBe(true);
 expect(portionBoundary(real('4b5dae')).exclude_portion_inference).toBe(true);
 expect(portionBoundary('The pot rim was small, but the portion was too small as well.').exclude_portion_inference).toBe(false);
 expect(portionBoundary('The soup portion was too small.').explicit_food_quantity).toBe(true);
});
it.each([
 ['I asked for less chilli, but the dish was still very spicy.',true],
 ['The dish was spicy.',false],['I asked for less spice.',false],
 ['I asked for less spice and received the requested less spicy dish.',false],
 ['If I asked for less chilli but it was still spicy, I would complain.',false],
 ['I asked for less spice, but the dish was still very spicy. They later replaced it.',true],
])('rule regression: request and reported outcome, never spice alone: %s',(s,yes)=>expect(requestedCustomizationSignal(s).supported).toBe(yes));
it('the real customization critique survives customer speculation without establishing a preparation cause',()=>{
 expect(requestedCustomizationSignal(real('6fa38')).supported).toBe(true);
 expect(requestedCustomizationSignal(real('6fa38')).cause_established).toBe(false);
});
it.each([
 [real('9ce752'),true],['Do not advertise lunch buffet specials during dinner.',true],
 ['They advertised a lunch buffet.',false],['If they advertise lunch during dinner, it might confuse me.',false],
 ['They did not advertise lunch specials during dinner.',false],
])('rule regression: commercial information is not silently discarded: %s',(s,yes)=>expect(commercialCommunicationSignal(s)).toBe(yes));
it('parking uncertainty is a reported clarity signal without known fee, overcharge or fault',()=>{
 expect(parkingFeeSignal(real('20b363'))).toMatchObject({supported:true,amount_known:false,overcharge_established:false,restaurant_fault_established:false});
 expect(parkingFeeSignal('Could you clarify the parking fee?').supported).toBe(false);
 expect(parkingFeeSignal('The attendant clearly explained the parking fee.').supported).toBe(false);
});
it.each([['Good service.',true],['Excellent service and delicious food.',true],['Good service: the staff worked together and all courses arrived together.',false],['The handoff between servers was well organized.',false]])('rule regression: coordination requires organization: %s',(s,yes)=>expect(genericCoordinationOnly(s)).toBe(yes));
it('new extracted candidates have no reference or Luna verdict and preserve exact offsets',()=>{
 for(const prefix of ['6fa38','9ce752','20b363']){
  const text=real(prefix),spans=auditCandidateSpans(text);expect(spans.length).toBeGreaterThan(0);
  for(const s of spans){expect(text.slice(s.start,s.end)).toBe(s.quote);expect(s.luna_verdict).toBeNull();expect(s.reference_annotation).toBeNull();expect(s.association_source).toContain('not_jev_prediction');}
 }
});
let memo:ReturnType<typeof prioritizedFixture>;
const fixture=()=>memo??=prioritizedFixture('fr');
it('changed evidence and Luna question identities invalidate verdict reuse without mutating the source',async()=>{
 const f=await fixture(),before=await hybridHash(f.p),e=f.p.selected[0];
 const row=f.snapshot.source.reviews.find(r=>r.id===e.review_id)!;
 const next=await refineAuditBoundaryEvidence(e,row.analysis_text!);
 expect(next.evidence_id).not.toBe(e.evidence_id);expect(next.luna_verdict).toBeNull();
 const q=await auditBoundaryQuestions(f.p);expect(q.groups.length).toBe(f.p.luna_groups.length);
 expect(q.groups[0].request_sha256).not.toBe(f.p.luna_groups[0].request_sha256);expect(q.spending_authorization).toBeNull();
 expect(await hybridHash(f.p)).toBe(before);
});
it('new report prompt/schema/config have independent hashes; historical V2.1 drafts remain stable',async()=>{
 const f=await fixture(),old=await buildRecommendationDraftV21(f.p,f.decisions),next=await buildRecommendationDraftV22(f.p,f.decisions);
 expect(next.version).toBe(CONTRACT_V22);expect(next.prompt_sha256).not.toBe(old.prompt_sha256);expect(next.schema_sha256).not.toBe(old.schema_sha256);
 expect(next.config_sha256).not.toBe(old.config_sha256);expect(next.spending_authorization).toBeNull();
 expect((await buildRecommendationDraftV21(f.p,f.decisions)).request_sha256).toBe(old.request_sha256);
});
it('free review preparation preserves sources, excludes contested associations, and rejects cross-organization inputs',async()=>{
 const f=await fixture(),scope={organization_id:f.snapshot.organization_id,establishment_id:f.snapshot.establishment_id},before=await hybridHash(f.snapshot);
 const next=await prepareAuditEvidenceReview(f.snapshot.source.reviews,f.p.selected,scope);
 expect(next.statistics_unchanged).toBe(true);expect(next.new_paid_calls).toBe(0);expect(next.spending_authorization).toBeNull();
 expect(await hybridHash(f.snapshot)).toBe(before);
 expect(await prepareAuditEvidenceReview(f.snapshot.source.reviews,f.p.selected,scope)).toEqual(next);
 await expect(prepareAuditEvidenceReview(f.snapshot.source.reviews,f.p.selected,{...scope,organization_id:'other'})).rejects.toThrow('AUDIT_TENANT_MISMATCH');
});
async function mockRecommendation(kind:'spice'|'promotion'|'parking'){
 const cases={spice:{text:'I asked for less chilli, but they served the wrong spice level and the dish was still very spicy.',theme:'order_accuracy',topic:'service_flow',axis:'service',focus:'order_customization',action:'Vérifier le suivi des demandes de réduction du piment.'},
 promotion:{text:'They explained the lunch buffet offer during dinner, but I caution them not to advertise it during dinner.',theme:'communication',topic:'communication',axis:'service',focus:'commercial_communication',action:'Revoir les horaires de présentation des offres du déjeuner.'},
 parking:{text:'The guard said the parking fee was negotiable, so I am not sure if there is a parking fee; please clarify the parking fee.',theme:'billing',topic:'fee_disclosure',axis:'price',focus:'parking_fee_clarification',action:'Clarifier l’existence et le montant des frais de stationnement.'}}[kind];
 const f=await prioritizedFixture('fr',undefined,{5:{text:cases.text,themes:[cases.theme+':negative']}});
 const raw=structuralRecommendationRevision(f.raw,f.p.statistics_sha256).raw;
 const e=f.p.selected.find(e=>e.theme_key===cases.theme&&e.polarity==='negative'&&e.context===cases.text);if(!e)throw Error('SYNTHETIC_EVIDENCE_MISSING_'+kind);
 const a=raw.report.recommendations[0];Object.assign(a,{title:'Vérifier le signal rapporté',axis:cases.axis,topic:cases.topic,evidence_ids:[e.evidence_id],
 observations:[{text:'Le client rapporte un point à clarifier.',evidence_id:e.evidence_id,theme_key:e.theme_key,polarity:'negative',quote:e.quote,quote_sha256:e.quote_sha256,context_quote:e.context,context_sha256:await negativeHash(e.context),context_summary:'Le client demande une vérification ; aucune cause ni faute n’est établie.'}],
 proposed_action:{kind:'review',focus:cases.focus,text:cases.action},priority:{rank:1,basis:'sourced_signal',reason:'Le signal permet une vérification ciblée.',frequency_keys:[],comparison_context:[]}});
 raw.report.recommendations=[a];return {f,raw};
}
it.each(['spice','promotion','parking'] as const)('simulated response plumbing only: exact accepted %s evidence supports its limited new action',async kind=>{
 const {f,raw}=await mockRecommendation(kind),v=await validateRecommendationReportV22(raw,f.p,f.snapshot,f.decisions);
 expect(v.report.recommendations[0].reasons).toEqual([]);expect(v.report.recommendations[0].visible).toBe(true);expect(v.report.recommendations.length).toBe(1);
});
it.each(['quote','context','theme','frequency','decision'])('simulated response binding rejects changed %s',async kind=>{
 const {f,raw}=await mockRecommendation('parking'),ds=structuredClone(f.decisions),a=raw.report.recommendations[0];
 if(kind==='quote')a.observations[0].quote+=' altered';if(kind==='context')a.observations[0].context_quote+=' altered';
 if(kind==='theme')a.observations[0].theme_key='value';if(kind==='frequency')a.priority.frequency_keys=['value:negative'];
 if(kind==='decision')ds.find(d=>d.evidence_id===a.evidence_ids[0])!.status='UNCERTAIN';
 try{expect((await validateRecommendationReportV22(raw,f.p,f.snapshot,ds)).report.recommendations[0].visible).toBe(false);}catch(e){expect(kind).toBe('decision');expect(String(e)).toMatch(/LUNA|DECISION_BINDING/);}
});
it('simulated output cannot turn unclear parking fees into an overcharge or legal conclusion',async()=>{
 const {f,raw}=await mockRecommendation('parking');raw.report.recommendations[0].proposed_action.text='Corriger la surfacturation illégale du stationnement.';
 const v=await validateRecommendationReportV22(raw,f.p,f.snapshot,f.decisions);expect(v.report.recommendations[0].visible).toBe(false);
});
