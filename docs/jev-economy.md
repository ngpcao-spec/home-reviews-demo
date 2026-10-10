# JEV economic preparation — 2026-10-10

`v12_economy_1pass_v1` copies the frozen V12 questions and thresholds independently, using one evaluation per English review. Requested model `jev-latest`, concurrency ceiling 8, 25 choice questions, no Sol extraction. There is no paid worker, cron or launch endpoint. The API rejects POST and the engine dispatcher always fails closed. Current HOME Reviews reports and V11/V12/V13 remain unchanged.

Access: Plus / Thêm → Test Jev → JEV — Mode économique. The screen reads persisted retrospective comparisons and estimates, with server authentication and owner/admin/manager organization checks. Pageshow/visibility refresh is GET only. The future cost dialog cannot launch anything.

## Retrospective replay (no new requests)

References are exactly the AI references captured in each historical run's prepared snapshot. Later audits do not overwrite them. All three V12 responses must be complete and valid; the same cohort is used for pass 1, pass 2, pass 3 and mean 3. Uncertain labels are excluded in both polarities. Precision/recall/F1 count theme polarity presence and do not use true negatives. Macro F1 requires support ≥ 3. The 2000-resample bootstrap pairs reviews, not responses.

| Frozen dataset | V12 reviews | Negative F1 pass 1 / 2 / 3 / mean | Positive F1 pass 1 / 2 / 3 / mean |
|---|---:|---|---|
| Artisan first | 30 | .9182 / .8944 / .9068 / .9125 | .8722 / .8722 / .8722 / .8636 |
| Artisan second | 32 | .8725 / .8725 / .8725 / .8725 | .8690 / .8649 / .8707 / .8767 |
| Third sample | 32 | .8182 / .8257 / .8182 / .8257 | .8679 / .8679 / .8762 / .8762 |

The second cohort includes all 32 complete V12 reviews, whereas the older V11 comparison had 31. Uncertain labels: 13 / 11 / 15. Historical raw choice stability: 99.33% / 99.125% / 99.0%. Stability is **not measurable for a new single response**. The first pass loses .0075 negative F1 and .0083 positive F1 on the third sample; no broad equivalence or independent human performance claim is justified.

Diagnostic theme flags (support ≥ 3, F1 drop ≥ .03): first sample food_quality− and price_level− on pass 2; second friendly_staff+ on pass 2, attentiveness+ on pass 3, atmosphere+ on pass 1; third food_quality− on pass 1, food_quality+ on passes 1/2 and attentiveness+ on pass 2. This flag is not a significance test and does not change thresholds.

## Permanent cache

`analysis_jev_review_cache` and append-only events are separate from historical benchmarks. Exact identity includes organization, establishment, review ID, untrimmed English text SHA256, instruction/threshold version and SHA256, economy configuration, requested and expected served models. A floating `jev-latest` alone is insufficient for reuse. A known served version must be explicitly pinned in the identity; model changes create a new identity.

Complete historical pass-1 responses can be copied into this new cache with their original response, tokens, cost, served model, processing timestamp and source task/run IDs. This creates no new paid evaluation. A changed provider translation or verified English override invalidates reuse by SHA256. Raw translations and frozen benchmarks remain untouched.

Reservations use a database transaction advisory lock plus unique keys. Concurrent claims return the same reservation and only its creator gets `claimed=true`. Reserved, dispatched and billing-uncertain entries cannot trigger a fresh request on resume. Completed and billing-uncertain entries are immutable. No automatic retry exists; paid dispatch is disabled at both application and trigger boundaries. No arbitrary alias can bypass a completed identity.

The future consolidation helper checks the exact cached identity again before creating Jev findings, then performs the existing deterministic Google cross-rating. It prepares **counts only** for a separate future Sol narrative; it does not call a model or publish a report. Textless stars remain in total counts, with zero Jev calls. Missing English reviews are counted separately and never silently analyzed in another language.

## Costs

Measured pass-1 input total 796,281 tokens / 94 reviews = 8,471.07 tokens per review. Output total 105,796 = 1,125.49 per review. All served models in these responses: `jev-1.13.0`.

Persisted Jev rates: input USD .042 / million; output USD 0 / million in these benchmark configurations. Recorded pass-1 cost USD .033443802; three passes USD .100331406. Measured input/output token and cost savings are 66.67%. These are stored estimated rates, not a claim about future vendor pricing.

| New English text reviews | Jev 1 pass | Jev 3 passes | Separate Sol narrative | Known Jev + Sol subtotal |
|---:|---:|---:|---:|---:|
| 100 | $0.035579 | $0.106736 | $0.022524 | $0.058103 |
| 500 | $0.177893 | $0.533678 | $0.022524 | $0.200417 |
| 1000 | $0.355785 | $1.067355 | $0.022524 | $0.378309 |
| 5000 | $1.778926 | $5.336777 | $0.022524 | $1.801450 |

Sol uses the measured V9 narrative (4162 input, 1420 output tokens) and recorded $2/$10 per million rates, once per report. This is a constant aggregate-report estimate, not per-review extraction. The future narrative size may differ. Apify import and optional English translation have no recorded unit tariffs in the inspected schema/application: both remain **null / non chiffré**. A complete all-provider total therefore remains unknown. Incremental Jev cost uses only uncached, ready English reviews. Scenario tables assume every listed review has English text; actual textless/missing-English reviews are excluded from planned calls.

## Compact candidate

`v12_economy_compact_experimental_v1` is a separately frozen, disabled question set. Full V12 repeats untrusted/common rules per theme and combines V11 interpretation with V12 boundaries. The proposed compact version keeps per-theme boundaries and four criteria using concise instructions. Question JSON shrinks from 40,302 to 20,395 characters (49.39%). This is **character reduction**, not measured provider tokens or validated predictive equivalence.

Public TypeSafe OpenAPI inspected 2026-10-10: `SystemOneRequest` contains model/state/questions and choice questions accept type/instructions/criteria. The candidate uses those fields only and state remains review_alias/analysis_text. No API key, model listing or paid evaluation was used for this check. A future explicitly authorized paired test is required before considering deployment of compact semantics.

## Validation and deployment

Unit tests cover direct one-pass probabilities, unchanged historical configs, complete paired cohorts, uncertain/zero support, cost nulls, cache identity/idempotence, role gates and disabled paid actions. SQL/RLS tests run in a rollback-only transaction on the new economy schema. Deno tests deny network. Mobile Playwright tests use synthetic data, FR/VI, widths 360/390/430/768, reload, disabled confirmation and provider-traffic assertions.

Deployment verification: 1112 unit tests, three offline Deno tests, SQL/RLS rollback assertions, lint/build, four mobile/iPad FR/VI Playwright checks passed. The new cache contains 94 reused historical pass-1 responses and three offline comparison snapshots. Seeding twice retains 94 rows and 94 events. Fingerprints of 53 pre-existing historical/reference/review tables stayed identical. Edge GET without authentication returns 401; any paid POST returns 405. No new security-advisor finding; the new cache foreign keys have covering indexes.

`scripts/replay-jev-economy.ts` accepts a private `EconomySource[]` JSON export and writes an offline comparison file under Deno with network denied. It never updates Supabase or a reference. No provider call, new historical report, benchmark run, production activation, historical relabeling or threshold change is authorized by this preparation.
