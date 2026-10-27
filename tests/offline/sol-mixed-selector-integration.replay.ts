import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {it,expect,vi} from 'vitest';
import {batchSolDraft,measureBatchSolDraft} from '../../supabase/functions/_shared/jev-batch-experiment';
import {MIXED_SELECTOR_VERSION,evidenceSelectorBinding} from '../../supabase/functions/_shared/report-evidence-selector';
import {directCanonical} from '../../supabase/functions/_shared/jev-direct-categories';
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text';
import {verifyCompactSolWire} from '../../supabase/functions/_shared/parallel-sol-wire';
const root=process.env.HOME_REVIEWS_MIXED_REPLAY_ROOT;
if(!root||!existsSync(root))throw Error('HOME_REVIEWS_MIXED_REPLAY_ROOT must point to the frozen mixed-priority audit directory. No network fallback.');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const frozen=read('tests/fixtures/sol-mixed-replay-manifest.json'),results:unknown[]=[];
it('replays all six saved dossiers through the normal batch worker with the production binding and exact tested Sol wires',async()=>{
 const deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'));
 try{
 const binding=await evidenceSelectorBinding(MIXED_SELECTOR_VERSION);
 for(const fixture of frozen.corpora){
  const [slug,age]=fixture.file.split('-'),source=read(age==='new'?path.join(root!,'corpora',slug+'-new.json'):path.resolve(root!,'../sol-evidence-priority-20261026/corpora',slug+'.json'));
  const expected=read(path.join(root!,'comparison-'+fixture.file+'.json')),before=structuredClone(source);
  const baseline=await batchSolDraft(source.run,source.tasks);expect(baseline.request_json).toBe(source.run.envelope.request_json);
  const run=structuredClone(source.run);run.template.evidence_selector=binding;
  const draft=await batchSolDraft(run,source.tasks),envelope=await measureBatchSolDraft(draft);
  expect(envelope.evidence_selector).toEqual(binding);expect(envelope.selection.version).toBe(MIXED_SELECTOR_VERSION);
  expect({...envelope.selection,version:expected.after.diagnostics.version}).toEqual(expected.after.diagnostics);
  expect(envelope.evidence).toEqual(expected.after.selected);
  expect(envelope.evidence.map(e=>e.evidence_id)).toEqual(fixture.after_ordered_associations);
  expect(envelope.request_json).toBe(expected.after_packet.request_json);
  expect(envelope.request_raw_sha256).toBe(fixture.after_request_sha256);expect(await analysisTextSha256(envelope.request_json)).toBe(fixture.after_request_sha256);
  expect(envelope.compact_manifest).toEqual(expected.after_packet.manifest);expect(envelope.packet).toEqual(expected.after_packet.packet);
  expect(envelope.statistics).toEqual(baseline.statistics);expect(envelope.classification_sources).toEqual(baseline.classification_sources);
  expect(envelope.evidence).toHaveLength(32);expect(new Set(envelope.evidence.map(e=>e.evidence_id)).size).toBe(32);
  for(const e of envelope.evidence.filter(e=>e.jev_native.classification==='mixed'))expect(envelope.evidence.filter(x=>x.review_id===e.review_id&&x.category===e.category).map(x=>x.polarity).sort()).toEqual(['negative','positive']);
  expect(envelope.selection.missing_positive_illustration_categories).toEqual([]);
  await verifyCompactSolWire({organization_id:run.organization_id,establishment_id:run.establishment_id,source_snapshot_sha256:run.snapshot_sha256,
   statistics:envelope.statistics,statistics_sha256:envelope.statistics_sha256,evidence:envelope.evidence,reviews:run.snapshot.reviews},run.template.packet.language,
   envelope.compact_manifest,envelope.compact_manifest_sha256,envelope.packet);
  if(fixture.file==='bottega26-new'){
   const tuna=envelope.evidence.filter(e=>e.review_id==='d2838f11-9ae8-4db8-978a-6ea95bde9c1f'&&e.category==='quality');
   expect(tuna.map(e=>e.polarity).sort()).toEqual(['negative','positive']);
   const actual=read(path.resolve(root!,'../sol-mixed-sol-bottega-20261026/sealed-manifest.json'));
   expect(actual.experiment_id).toBe('b5709377-d629-4bec-8a36-7555299c34cc');expect(actual.request_sha256).toBe(envelope.request_raw_sha256);
   expect(envelope.compact_manifest.associations.filter(a=>a.review_id===tuna[0].review_id&&a.category==='quality')).toEqual(actual.target_quality_refs);
  }
  expect(directCanonical(source)).toBe(directCanonical(before));
  results.push({corpus:fixture.file,source_run_id:run.id,source_snapshot_sha256:run.snapshot_sha256,production_selector:binding,associations:32,
   ordered_associations_exact:true,sol_wire_exact:true,compact_references_exact:true,request_sha256:envelope.request_raw_sha256,statistics_unchanged:true,native_classifications_unchanged:true,
   complete_mixed_pairs:true,positive_illustration_categories:envelope.selection.positive_illustration_categories,selected_reviews:new Set(envelope.evidence.map(e=>e.review_id)).size,
   input_estimate:envelope.measurement.local_input_tokens,request_bytes:envelope.measurement.request_bytes});
 }
 expect(deny).not.toHaveBeenCalled();writeFileSync('docs/verification/sol-mixed-selector-replay-20261026.json',JSON.stringify({production_selector:binding,tested_source_sha256:frozen.proposal_function_sha256,
  tested_commit:'f1627c4e7e86314e61af9e103a52016cca8dfc5d',experiment_id:'b5709377-d629-4bec-8a36-7555299c34cc',provider_calls:0,results},null,2)+'\n');
 }finally{deny.mockRestore();}
},180000);
