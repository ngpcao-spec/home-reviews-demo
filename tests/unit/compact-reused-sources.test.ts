import {describe,it,expect} from 'vitest';
import {compactComparisonFixture} from '../fixtures/compact-sol-comparison';
import {prepareCompactComparison,verifyCompactComparison} from '../../supabase/functions/_shared/compact-sol-comparison';
import {verifyCandidateSource} from '../../supabase/functions/_shared/jls-direct4-candidates';
import {directHash} from '../../supabase/functions/_shared/jev-direct-categories';

describe('opt-in compact reuse of short-common classifications',()=>{
 it('preserves 87 results, four missing texts and nine textless reviews without changing the compact prompt',async()=>{
  const {protocol:p}=await compactComparisonFixture(true),legacy=await compactComparisonFixture();
  await verifyCompactComparison(p.body,p.sha256);
  expect(p.body.source.statistics.scope).toEqual({source_reviews:100,analysed_text_reviews:87,textless_statistics_only:9,technical_missing_reviews:4,textual_source_reviews:91});
  expect(p.body.configuration).toEqual(legacy.protocol.body.configuration);
  expect(p.body.max_sol_calls).toBe(1);expect(p.body.max_jev_calls+p.body.max_luna_calls).toBe(0);
 });
 it('refuses an old long-prompt classification identity and fictitious completeness',async()=>{
  const {protocol:p}=await compactComparisonFixture(true);
  const s=structuredClone(p.body.source);s.source_binding!.dataset_binding.classification_configuration!.id='jev_categories4_direct_1pass_v1';
  await expect(verifyCandidateSource(s)).rejects.toThrow('COMPACT_REUSED_SCOPE_CHANGED');
  const t=structuredClone(p.body.source);t.statistics.scope.technical_missing_reviews=0;t.statistics_sha256=await directHash(t.statistics);
  await expect(verifyCandidateSource(t)).rejects.toThrow('COMPACT_REUSED_SCOPE_CHANGED');
 });
 it('refuses a missing review introduced into selection or a changed saved response',async()=>{
  const {protocol:p,archive:a}=await compactComparisonFixture(true),s=structuredClone(p.body.source);
  s.selected[0].review_id=s.source_binding!.dataset_binding.technical_missing_review_ids![0];
  await expect(verifyCandidateSource(s)).rejects.toThrow('COMPACT_REUSED_SCOPE_CHANGED');
  a.body.source_input.dataset.body.reviews[0].raw_response_text='{}';a.sha256=await directHash(a.body);
  await expect(prepareCompactComparison(a,'a'.repeat(40))).rejects.toThrow();
 });
});
