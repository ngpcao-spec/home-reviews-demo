// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- Actual saved receipts are validated using production parsers, not treated as trusted fixtures. */
import {it,expect,vi} from 'vitest';import fs from 'node:fs';
import {batchSolDraft,validateBatchTask} from '../../supabase/functions/_shared/jev-batch-experiment';
import {directReportCandidates} from '../../supabase/functions/_shared/jev-direct-report-preparation';
import {directHash,directCanonical} from '../../supabase/functions/_shared/jev-direct-categories';
import {analysisTextSha256} from '../../supabase/functions/_shared/analysis-text';
import {selectSourceCompletePriorityEvidence} from '../../supabase/functions/_shared/jev-priority-evidence-selection';
import {selectMixedSourceCompletePriorityEvidence} from '../../experiments/evidence-priority/mixed-source-completion-proposal';
import {prepareCompactSolWire} from '../../supabase/functions/_shared/parallel-sol-wire';
import {solRequestSize} from '../../supabase/functions/_shared/jls-sol-size';
const suppliedRoot=process.env.HOME_REVIEWS_MIXED_REPLAY_ROOT;
if(!suppliedRoot||!fs.existsSync(suppliedRoot))throw Error('HOME_REVIEWS_MIXED_REPLAY_ROOT must point to the saved mixed audit directory. No network fallback.');
const root=suppliedRoot.replaceAll(String.fromCharCode(92),'/').replace(/\/?$/,'/');
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8')),write=(p:string,x:unknown)=>fs.writeFileSync(root+p+'.json',JSON.stringify(x,null,2));
const frozen=read('tests/fixtures/sol-mixed-replay-manifest.json');
it('reproduces six saved dossiers and compares the isolated atomic mixed-source tie break without network',async()=>{
 const deny=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'));
 const summaries=[];
 try{
 for(const slug of ['khouse','bottega26','optimist'])for(const age of ['historical','new']){
  const source=read(age==='new'?root+'corpora/'+slug+'-new.json':root+'../sol-evidence-priority-20261026/corpora/'+slug+'.json');
  const {run,tasks}=structuredClone(source),sourceBefore=directCanonical(source),rows:any[]=[];
  const rawDraft=await batchSolDraft(run,tasks);expect(rawDraft.request_json).toBe(run.envelope.request_json);
  for(const task of [...tasks].sort((a:any,b:any)=>a.number-b.number)){
   const p=await validateBatchTask(run,task);expect(p).toEqual(task.projection);
   for(const x of p.rows){const r=run.snapshot.reviews.find((r:any)=>r.id===x.review_id)!;rows.push({review_id:r.id,organization_id:run.organization_id,establishment_id:run.establishment_id,
    analysis_text:r.analysis_text,analysis_text_sha256:r.analysis_text_sha256,analysis_language:r.analysis_language??'und',result:x.result,result_sha256:await directHash(x.result),
    raw_response_text:JSON.stringify(x.result.raw_response),response_raw_sha256:await analysisTextSha256(JSON.stringify(x.result.raw_response)),translation_source:r.analysis_source,
    translation_provenance:r.translation_provenance,receipt_id:task.id});}
  }
  const candidates=await directReportCandidates({dataset:{body:{reviews:rows,configuration_id:'jev_categories4_short_common_1pass_v1'}},snapshot:{body:run.snapshot}} as any),nativeBefore=directCanonical(candidates);
  const before=selectSourceCompletePriorityEvidence(candidates),after=selectMixedSourceCompletePriorityEvidence(candidates);
  const expected=age==='new'?run.envelope:read(root+'../sol-priority-experiment-20261026/frozen-'+slug+'.json').envelope;
  expect(before.selected).toEqual(expected.evidence);
  const packet=async(selection:typeof before|typeof after)=>{
   const compact=await prepareCompactSolWire({organization_id:run.organization_id,establishment_id:run.establishment_id,source_snapshot_sha256:run.snapshot_sha256,
    statistics:rawDraft.statistics,statistics_sha256:rawDraft.statistics_sha256,evidence:selection.selected,reviews:run.snapshot.reviews},run.template.packet.language);
   const request=JSON.parse(run.template.request_json);request.input=[{role:'system',content:compact.prompt},{role:'user',content:JSON.stringify(compact.packet)}];
   return {...compact,request_json:JSON.stringify(request),request_sha256:await analysisTextSha256(JSON.stringify(request)),measurement:solRequestSize(request)};
  };
  const oldPacket=await packet(before),newPacket=await packet(after);expect(await analysisTextSha256(oldPacket.request_json)).toBe(await analysisTextSha256(expected.request_json));
  const pinned=frozen.corpora.find((c:any)=>c.file===slug+'-'+age);
  expect(run.id).toBe(pinned.run_id);expect(run.snapshot_sha256).toBe(pinned.source_snapshot_sha256);
  expect(oldPacket.request_sha256).toBe(pinned.before_request_sha256);expect(newPacket.request_sha256).toBe(pinned.after_request_sha256);
  expect(before.selected.map(e=>e.evidence_id)).toEqual(pinned.before_ordered_associations);
  expect(after.selected.map(e=>e.evidence_id)).toEqual(pinned.after_ordered_associations);
  expect(directCanonical(candidates)).toBe(nativeBefore);expect(directCanonical(source)).toBe(sourceBefore);
  for(const s of [before,after]){
   expect(s.selected.length).toBeLessThanOrEqual(32);
   for(const e of s.selected.filter(e=>e.jev_native.classification==='mixed'))expect(s.selected.filter(x=>x.review_id===e.review_id&&x.category===e.category).map(x=>x.polarity).sort()).toEqual(['negative','positive']);
   for(const category of ['service','price','quality','ambiance'])if(candidates.some(e=>e.category===category&&e.polarity==='positive'))expect(s.selected.some(e=>e.category===category&&e.polarity==='positive')).toBe(true);
  }
  const describe=(e:any)=>({...e,original:run.snapshot.reviews.find((r:any)=>r.id===e.review_id).original_text});
  const added=after.selected.filter(e=>!before.selected.some(x=>x.evidence_id===e.evidence_id)).map(describe),removed=before.selected.filter(e=>!after.selected.some(x=>x.evidence_id===e.evidence_id)).map(describe);
  const target=slug==='bottega26'?'d2838f11':slug==='khouse'?'89eadd38':'5ee0e75b';
  const result={slug,age,name:source.name,run_id:run.id,report_id:run.report_id,source_snapshot:run.snapshot,source_snapshot_sha256:run.snapshot_sha256,
   classifications_sha256:await directHash(rows.map(r=>({review_id:r.review_id,result_sha256:r.result_sha256}))),candidates,before,after,added,removed,before_packet:oldPacket,after_packet:newPacket,
   unchanged:{native_answers:true,probabilities:true,statistics:true,source_texts:true},saved_dossier_reproduced:true,provider_calls:0};
  expect(result.classifications_sha256).toBe(pinned.classifications_sha256);
  write('comparison-'+slug+'-'+age,result);
  summaries.push({slug,age,report:run.report_id,before:before.selected.length,after:after.selected.length,added:added.map(e=>({id:e.review_id.slice(0,8),cat:e.category,pol:e.polarity,stars:e.rating})),removed:removed.map(e=>({id:e.review_id.slice(0,8),cat:e.category,pol:e.polarity,stars:e.rating})),target_before:before.selected.filter(e=>e.review_id.startsWith(target)&&e.category==='quality').map(e=>e.polarity),target_after:after.selected.filter(e=>e.review_id.startsWith(target)&&e.category==='quality').map(e=>e.polarity),diagnostics_after:after.diagnostics});
 }
 write('replay-summary',summaries);expect(deny).not.toHaveBeenCalled();console.log(JSON.stringify(summaries.map(s=>({slug:s.slug,age:s.age,added:s.added,removed:s.removed}))));
 }finally{deny.mockRestore();}
},180000);
