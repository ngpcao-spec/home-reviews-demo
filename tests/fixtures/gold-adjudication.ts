// Synthetic test data only; never selected or saved in production.
import {syntheticGold,syntheticLabels} from './human-gold'
import {goldFingerprints} from '../../supabase/functions/_shared/gold-api'
import {ADJUDICATION_GOLD_ID,adjudicationFingerprint,type AdjudicationBundle} from '../../supabase/functions/_shared/gold-adjudication-core'
import type {Adjudication} from '../../supabase/functions/_shared/gold-adjudication-api'
export const fakeAdjudicationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export async function syntheticAdjudicationBundle():Promise<AdjudicationBundle>{const f=await syntheticGold();f.set.id=ADJUDICATION_GOLD_ID;f.set.status='completed';f.set.completed_at='2026-10-07T00:00:00Z';f.labels=syntheticLabels(f.rows.map(r=>r.review_id));for(const row of f.rows.slice(0,8))f.labels.find(l=>l.review_id===row.review_id&&l.theme_key==='atmosphere')!.choice='positive';Object.assign(f.set,await goldFingerprints(f.source,f.benchmark));return {gold:f.set,source:f.source,benchmark:f.benchmark,goldReviews:f.rows,goldLabels:f.labels}}
export async function syntheticAdjudication(b:AdjudicationBundle):Promise<Adjudication>{return {id:fakeAdjudicationId,gold_set_id:ADJUDICATION_GOLD_ID,organization_id:'org',name:'shabu-v7-human-check-v1',methodology:'human_final_adjudication_v1',status:'draft',target_reviews:12,revision:0,taxonomy:b.gold.taxonomy,source_fingerprint:await adjudicationFingerprint(b),comparison:null,created_at:'2026-10-07T00:00:00Z',completed_at:null}}
