// @vitest-environment node
import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {syntheticSources,syntheticGold,syntheticLabels,reviewId} from '../../../tests/fixtures/human-gold'
import {selectGoldReviews,replacementGoldReview,validateGoldSources,normalizeGoldLabels,averagedPresence,jevChoice,solChoice,compareGold} from './gold-core'
import {GOLD_KEYS} from './gold-taxonomy'
describe('Human Gold deterministic selection and scoring',()=>{
  it('selects exactly 40 unique English textual reviews, 32 diagnostic + 8 controls, independent of input order',async()=>{
    const {source,benchmark}=syntheticSources();validateGoldSources(source,benchmark)
    const a=await selectGoldReviews(source,benchmark),b=await selectGoldReviews({...source,snapshot:{...source.snapshot,reviews:[...source.snapshot.reviews].reverse()}},benchmark)
    expect(a).toEqual(b);expect(a).toHaveLength(40);expect(new Set(a.map(r=>r.review_id)).size).toBe(40);expect(a.filter(r=>r.selection_bucket==='control')).toHaveLength(8)
    expect(a.every(r=>source.snapshot.reviews.find(x=>x.id===r.review_id)?.analysis_text.trim())).toBe(true)
    expect(JSON.stringify(a)).not.toMatch(/analysis_text":|original_text|rating/)
  })
  it('replacement is deterministic, never reuses an excluded ID, keeps position and control reservation',async()=>{
    const {source,benchmark}=syntheticSources(),rows=await selectGoldReviews(source,benchmark),control=rows.find(r=>r.selection_bucket==='control')!
    const replacement=await replacementGoldReview(source,benchmark,rows,control.review_id)
    expect(rows.some(r=>r.review_id===replacement.review_id)).toBe(false);expect(replacement.position).toBe(control.position);expect(replacement.selection_bucket).toBe('control')
    expect(replacement).toEqual(await replacementGoldReview(source,benchmark,rows,control.review_id))
  })
  it('normalizes absent defaults and all human choices without inference',()=>{
    const choices=normalizeGoldLabels({friendly_staff:'positive',attentiveness:'uncertain',professionalism:'both',wait_time:'negative'})
    expect(Object.keys(choices)).toHaveLength(25);expect(choices.food_quality).toBe('absent');expect(choices.attentiveness).toBe('uncertain');expect(()=>normalizeGoldLabels({rating:'positive'})).toThrow('GOLD_CHOICES_INVALID')
  })
  it('maps Sol findings into all four Choices',()=>{const {source}=syntheticSources();expect(solChoice(source,reviewId(0),'food_quality')).toBe('positive');source.findings.push({review_id:reviewId(0),theme_key:'food_quality',sentiment:'negative'});expect(solChoice(source,reviewId(0),'food_quality')).toBe('both');expect(solChoice(source,reviewId(0),'noise')).toBe('absent');source.findings=[{review_id:reviewId(0),theme_key:'noise',sentiment:'negative'}];expect(solChoice(source,reviewId(0),'noise')).toBe('negative')})
  it('averages three probability vectors before thresholding; does not triple review support',()=>{const {benchmark}=syntheticSources();for(const [i,p] of [.3,.6,.9].entries())benchmark.decisions[0].repetitions[i]!.themes.food_quality.probabilities={absent:1-p,positive:p,negative:0,both:0};expect(averagedPresence(benchmark,reviewId(0),'food_quality').positive).toBeCloseTo(.6);expect(jevChoice(benchmark,reviewId(0),'food_quality',.5)).toBe('positive');expect(jevChoice(benchmark,reviewId(0),'food_quality',.7)).toBe('absent')})
  it('computes micro F1 without TN, macro support >=3, axes, exact agreement and deterministic review bootstrap',async()=>{
    const {source,benchmark,rows}=await syntheticGold(),labels=syntheticLabels(rows.map(r=>r.review_id));source.findings=rows.slice(1).map(r=>({review_id:r.review_id,theme_key:'food_quality',sentiment:'positive'}))
    for(const decision of benchmark.decisions)for(const rep of decision.repetitions)if(rep)for(const key of GOLD_KEYS)if(key!=='food_quality')rep.themes[key]={choice:'absent',probabilities:{absent:1,positive:0,negative:0,both:0}}
    const a=await compareGold('seed',source,benchmark,rows,labels),b=await compareGold('seed',source,benchmark,rows,labels)
    expect(a.sol.micro_f1_gold).toBe(78/79);expect(a.jev.micro_f1_gold).toBe(1);expect(a.sol.themes.food_quality.positive.support).toBe(40);expect(a.sol.macro_supported_labels).toBe(1);expect(a.sol.axes.quality.f1).toBe(78/79)
    expect(a.principal_threshold).toBe(.5);expect(a.exploratory['0.70'].exploratory).toBe(true);expect(a.disagreement_resolution).toMatchObject({gold_matches_jev_only:1,gold_matches_both:0,total:1})
    expect(a.bootstrap).toEqual(b.bootstrap);expect(a.bootstrap.resamples).toBe(2000);expect(a.bootstrap.method).toBe('review_level_paired_bootstrap');expect(a.verdict).toBe('inconclusive')
  })
  it('uncertain removes both polarity labels, excludes low support from macro and resolves ambiguity separately',async()=>{
    const {source,benchmark,rows}=await syntheticGold(),labels=syntheticLabels(rows.map(r=>r.review_id));labels.find(l=>l.review_id===reviewId(0)&&l.theme_key==='attentiveness')!.choice='uncertain'
    for(const label of labels.filter(l=>l.theme_key==='noise').slice(0,2))label.choice='negative'
    const c=await compareGold('seed',source,benchmark,rows,labels)
    expect(c.sol.themes.attentiveness.positive.uncertain).toBe(1);expect(c.sol.themes.attentiveness.negative.uncertain).toBe(1);expect(c.sol.themes.noise.negative.support).toBe(2);expect(c.sol.macro_supported_labels).toBe(1);expect(c.uncertain_label_count).toBe(1)
  })
  it('bootstrap direction is descriptive only and remains paired by review for clear differences',async()=>{
    const {source,benchmark,rows}=await syntheticGold(),labels=syntheticLabels(rows.map(r=>r.review_id))
    source.findings=rows.map(r=>({review_id:r.review_id,theme_key:'food_quality',sentiment:'positive'}))
    for(const decision of benchmark.decisions)for(const rep of decision.repetitions)if(rep)for(const key of GOLD_KEYS)rep.themes[key]={choice:'absent',probabilities:{absent:1,positive:0,negative:0,both:0}}
    const c=await compareGold('clear',source,benchmark,rows,labels);expect(c.bootstrap.delta).toBe(-1);expect(c.bootstrap.ci_95_high).toBe(-1);expect(c.verdict).toBe('sol_better_on_diagnostic_gold')
    source.findings=[];for(const decision of benchmark.decisions)for(const rep of decision.repetitions)if(rep)rep.themes.food_quality={choice:'positive',probabilities:{absent:0,positive:1,negative:0,both:0}}
    const improved=await compareGold('clear',source,benchmark,rows,labels);expect(improved.bootstrap.ci_95_low).toBe(1);expect(improved.verdict).toBe('jev_better_on_diagnostic_gold')
  })
  it('has no provider client, production mutation or automated annotation path',()=>{
    for(const file of ['gold-core.ts','gold-api.ts'])expect(readFileSync(new URL(file,import.meta.url),'utf8')).not.toMatch(/api\.openai|api\.typesafe|apify|structuredCall|consultantNarrative|fetch\(/)
    const entry=readFileSync(new URL('../human-gold-set/index.ts',import.meta.url),'utf8');expect(entry).not.toMatch(/\.insert\(|\.update\(|analyze-review|backfill-review/)
  })
})
