// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {recommendationSheet} from '../fixtures/restaurant-recommendation-catalogue';
import {prepareAi,renderChoices,validateChoices,candidateFacts} from '../../supabase/functions/_shared/recommendation-ai';
import {explainSavedReference} from '../../supabase/functions/_shared/recommendation-explanation';
import {placeProfile} from '../../supabase/functions/_shared/google-place-profile';

function fixture(language:'fr'|'vi'='fr',quiet:boolean=true){
 const row=recommendationSheet('synthetic-a',{positive:'Le poulet et sa sauce sont appréciés.',reservation:'placeholder'});
 row.language=language;row.publication!.language=language;
 const reservations=[
  {category:'service',text:'Un témoignage mentionne une attente.',evidence_ids:['b'.repeat(64)]},
  {category:'quality',text:'Un client a reçu un steak moins cuit que demandé, mais reste satisfait. Un autre trouve un morceau gras : ce sont deux reproches différents, sans preuve du même défaut répété.',evidence_ids:['c'.repeat(64),'d'.repeat(64)]},
  {category:'ambiance',text:'Un client souhaiterait davantage d’espace, tout en appréciant le cadre.',evidence_ids:['e'.repeat(64)]},
 ];
 row.report_sections.reservations=reservations;(row.publication!.derived.report as Record<string,unknown>).negative_aspects=reservations;
 row.metadata.google_place_profile={...placeProfile([{cid:'123',placeId:'place-123',language,scrapedAt:'2026-10-28T01:02:03Z',reviews:[],additionalInfo:{'Bầu không khí':[{'Yên tĩnh':quiet}]}}],{google_id:'123',place_id:'place-123',google_maps_url:'https://www.google.com/maps/search/?api=1&query_place_id=place-123',language}),binding:{establishment_id:row.establishment_id,organization_id:row.organization_id}};
 const catalogue={organizationId:row.organization_id,language,rows:[row],establishments:[{id:row.establishment_id,name:'Synthetic',organization_id:row.organization_id}]};
 const prepared=prepareAi(catalogue,{geography:'not_requested'},'Éviter le bruit et les problèmes de cuisson récurrents.');
 const render=(reasons:string[],caution:string|null='reservation_ambiance')=>renderChoices(validateChoices({choices:[{id:row.establishment_id,reason_refs:reasons,caution_ref:caution}]},prepared),prepared)[0];
 return {row,catalogue,prepared,render};
}
describe('faithful presentation of saved AI reference choices, with no provider',()=>{
 it('replaces the generic category label with the exact bound report excerpt, not generated prose',()=>{
  const f=fixture(),result=f.render(['strength_quality']);
  expect(result.reasons[0]).toMatchObject({text:'Le poulet et sa sauce sont appréciés.',display_kind:'report_extract',sources:[{kind:'report',report_id:f.row.report_id,category:'quality',section:'positive_aspects',index:0,evidence_ids:['a'.repeat(64)]}]});
 });
 it('uses the selected ambiance caution and its source, never the first unrelated service reservation',()=>{
  const f=fixture(),result=f.render(['score_service']);
  expect(result.caution?.text).toBe('Un client souhaiterait davantage d’espace, tout en appréciant le cadre.');
  expect(result.caution?.sources?.[0]).toMatchObject({kind:'report',category:'ambiance',section:'reservations',index:2});
  expect(JSON.stringify(result.caution)).not.toContain('attente');
 });
 it('preserves the entire qualifier and does not infer recurrence from two evidence associations',()=>{
  const f=fixture(),result=f.render(['score_global'],'reservation_quality');
  expect(result.caution?.text).toContain('mais reste satisfait');expect(result.caution?.text).toContain('deux reproches différents');
  expect(result.caution?.notes).toEqual(['recurrence_not_established']);expect(result.caution).not.toHaveProperty('recurring');
 });
 it.each(['fr','vi'] as const)('attributes quiet to the exact saved Google declaration in %s without fabricating a report source',language=>{
  const f=fixture(language),reason=f.render(['feature_quiet']).reasons[0];
  expect(reason.text).toContain('Google Maps');expect(reason.display_kind).toBe('google_declaration');
  expect(reason.sources).toEqual([{kind:'google_maps',observed_at:'2026-10-28T01:02:03Z',field:'additionalInfo.Bầu không khí.Yên tĩnh',label:'Yên tĩnh',value:true,url:'https://www.google.com/maps/search/?api=1&query_place_id=place-123'}]);
  expect(reason.notes).toEqual(['google_not_noise_measurement']);
 });
 it('preserves an explicit negative declaration, without declaring noise or its opposite',()=>{
  const reason=fixture('fr',false).render(['feature_quiet']).reasons[0];
  expect(reason.text).toContain('indique non');expect(reason.sources?.[0]).toMatchObject({kind:'google_maps',value:false});expect(reason.text).not.toContain('bruyant');
 });
 it('keeps contradictory Google/report sources distinct, without resolving them in presentation',()=>{
  const f=fixture(),p=f.prepared.proposals[0],citation={...p.reservations[0],category:'ambiance',text:'Un client mentionne une musique bruyante.'};
  p.features.quiet={...p.features.quiet,status:'conflicted',citations:[citation]};
  const fact=candidateFacts(p,'fr').find(x=>x.ref==='feature_quiet')!;
  const rendered=explainSavedReference(p,fact.ref,fact.label,fact.source,'fr');
  expect(rendered.text).toContain('contradictoires');expect(rendered.sources?.map(s=>s.kind)).toEqual(['google_maps','report']);
 });
 it('does not reattach a report reference to another report, category, index or evidence set',()=>{
  const f=fixture(),p=f.prepared.proposals[0],fact=f.prepared.facts.get(f.row.establishment_id)!.find(x=>x.ref==='reservation_quality')!;
  for(const change of [{report_id:'another-report'},{section:'positive_aspects'},{index:99},{evidence_ids:['f'.repeat(64)]}]){
   const bindings=structuredClone(fact.source) as Record<string,unknown>[];Object.assign(bindings[0],change);
   const result=explainSavedReference(p,fact.ref,fact.label,bindings,'fr');expect(result.display_kind).toBe('source_unavailable');expect(result.sources).toEqual([]);
  }
 });
 it('does not silently substitute a Google observation from another date',()=>{
  const f=fixture(),p=f.prepared.proposals[0],fact=f.prepared.facts.get(f.row.establishment_id)!.find(x=>x.ref==='feature_quiet')!;
  const source=structuredClone(fact.source) as {google:{observed_at:string}};source.google.observed_at='2020-01-01';
  expect(explainSavedReference(p,fact.ref,fact.label,source,'fr').display_kind).toBe('source_unavailable');
 });
 it('refuses unsafe or mismatching Google source links without dropping the saved declaration',()=>{
  for(const url of ['https://www.google.com/maps?cid=999','javascript:alert(1)','https://example.invalid/maps?cid=123','https://www.google.com.evil.invalid/maps?cid=123']){
   const f=fixture(),p=f.prepared.proposals[0];p.practical!.identity.google_maps_url=url;
   const reason=f.render(['feature_quiet']).reasons[0];expect(reason.sources?.[0]).toMatchObject({kind:'google_maps',url:null});
  }
 });
 it('keeps exact scores, selected references, rankings and model request bytes unchanged during rendering',()=>{
  const f=fixture(),request=JSON.stringify(f.prepared.request),proposals=structuredClone(f.prepared.proposals);
  const result=f.render(['score_service','strength_quality'],'reservation_quality');
  expect(result.reasons.map(r=>r.ref)).toEqual(['score_service','strength_quality']);expect(result.caution?.ref).toBe('reservation_quality');
  expect(result.reasons[0].sources?.[0]).toMatchObject({kind:'internal_score',category:'service',score:f.prepared.proposals[0].scores.service.value});
  expect(f.prepared.proposals).toEqual(proposals);expect(JSON.stringify(f.prepared.request)).toBe(request);
  expect(request).not.toContain('Le poulet');expect(request).not.toContain('Un client a reçu');
 });
});
