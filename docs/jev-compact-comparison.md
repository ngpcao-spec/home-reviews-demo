# Complete / compact Jev comparison — preparation only

The fixed configurations `v12_economy_1pass_v1` and `v12_economy_compact_experimental_v1` remain unchanged, including questions, thresholds and production-disabled flags. Their existing hashes are checked by the API before any operation. V11/V12/V13 and previous references/results are untouched.

## New sample

One draft set per organization, `compact-paired-new-reviews-v1`, with exactly 17 reviews rated 1–3, 11 rated 4, and 4 rated 5. Preparation requires owner/admin/manager membership. It preserves original text/language/SHA256, review/establishment/organization IDs and the selection hash. Authors are not stored.

The exclusion inventory reads review IDs only from existing benchmarks, historical Jev reports, Gold/calibration/adjudication rows, Artisan samples and reserved holdout items, V12 prepared cohorts, V13 sealed sources/tasks/audits and the permanent cache. No predictions are consulted. Selection prioritizes already available English versions, then SHA256 ordering within star strata with round-robin establishment coverage. This creates a deliberate star/language stratification, not restaurant-problem prevalence estimates.

Textless reviews and foreign-organization reviews cannot enter the set. Preparation is idempotent: a second call returns the same set and does not choose new IDs. The stored candidate inventory is the snapshot at preparation time.

## English and AI references

English texts are in a separate append-only table, with language `en`, original/text SHA256, source, model/provider provenance and timestamp. Already available originals/translations are copied without modifying `reviews` or `review_translations`. Missing English is **not** silently filled with original foreign text. No automatic translation or import provider exists in this workflow.

The mobile screen can export originals for separate translation and import an English JSON array. Imported rows require review_id, original_text_sha256, analysis_text, analysis_text_sha256, language=en, a declared source (`manual_chatgpt_translation_en` or `manual_verified_translation_en`), actual model_source and provenance. Only the 32 selected IDs and matching hashes are accepted. Once references are imported, text changes are locked.

After all 32 texts are ready, the blind reference export contains only review ID, English text and SHA256 plus the 25 theme keys and allowed choices. No ratings, buckets, original text, probabilities or JEV predictions are exported. ChatGPT annotations are prepared separately, then the user imports exactly 800 rows with choices absent/positive/negative/both/uncertain, actual model_source, `annotation_protocol=blind_to_jev_predictions` and `reference_type=ai_reference_not_human_gold`. No reference rows are fabricated or prefilled. Identical re-import is idempotent; rewriting an existing reference is refused.

A manual confirmation seals original/English hashes, 800 annotations, uncertainty count and both configuration hashes. Sealed data and annotations are immutable. The API/worker independently verifies the SHA256 values. If selected reviews have acquired earlier JEV usage before sealing, sealing is refused instead of quietly treating them as new.

## Explicit paid gate

This deployment creates **no authorization, benchmark run, task, result or provider request**. The launch button stays disabled until the texts/references are sealed and a separate server-only authorization records the user's explicit instruction, matching seal/configuration hashes, maximum 64 evaluations, expected served model and cost limit. The frontend cannot grant this authorization. A second explicit cost confirmation is required to enqueue a run.

`start_compact_run` is atomic and unique per set. It creates 64 tasks only after the gate passes. The durable server worker processes up to eight concurrent tasks and each uses `maxAttempts:1`. No Sol/OpenAI/Apify path exists. Scheduler execution is conditional on an explicitly started, authorized run; it never creates a run or references. The current disabled economic report engine remains disabled.

The permanent cache is reused with separate A/B identities. Organization, establishment, review ID, English SHA256, instruction/threshold versions and hashes, and expected served model all participate. The existing cache dispatcher is allowed only for a linked, active, authorized compact task; all other dispatches remain blocked. Completed cache entries stay immutable. Unconfirmed paid responses become terminal and are never automatically retried. If the actual served model changes, a result is recorded under its actual model identity and the expected-model reservation is blocked; the comparison flags version differences.

The cost limit is checked before subsequent dispatches; in-flight calls cannot be cancelled with a guaranteed refund. Actual provider charges depend on returned usage and stored rates. No hard spend guarantee can be inferred from an average token estimate.

## Costs and scoring

A cost forecast uses complete historical pass-1 V12 usage, including the configured input/output rates. B has no measured usage yet: its forecast and proven savings remain null. The indicative combined budget assumes B costs as much as A, explicitly labelled as an assumption. The earlier 49.4% character reduction is not represented as measured token savings.

After execution, each task stores its configuration, response/probabilities, served model, input/output tokens, cost, duration, cache reuse and error. Scores pair only reviews with two complete valid answers and exclude uncertain labels. Negative and positive precision/recall/F1, FP/FN, micro and supported macro F1, all 25 themes and four axes are retained. Bootstrap uses 2000 paired review resamples. Single-pass repeat stability is unavailable, not 100%.

Degradation flags require support ≥ 3 and an absolute F1 loss > .03. They are diagnostic, not a statistical verdict. Cost projections for 100/500/1000 are based on measured provider usage after the test. Failures/partial coverage and model changes must be read alongside the metrics. These are exploratory AI-reference results, not independently human-validated performance and not grounds for an automatic production switch.

## Access

Plus / Thêm → Test Jev → **JEV — Comparaison compacte** (`/plus/jev-compact`).

Order: inspect prepared set → export originals if translations are missing → import independently prepared English texts → export blind English reference input → import 800 AI annotations → confirm sealing → obtain explicit paid authorization separately → confirm cost and start manually → read comparison. Reload/pageshow resumes server state with GET only. No automatic paid POST is made.

RLS permits only owner/admin/manager within the source organization. Write RPCs and provider secrets are server-only. SQL tests use rollback-only writes to the new tables, and provider tests use synthetic fixtures/mocked clients with Deno network denied.

## Prepared dataset and verification

Set `e544eea5-1c9d-4b68-909e-38b68061e85f`, organization `93228bbb-6397-41e3-b8be-21ee7060eda7`, is a **draft only**. Preparation inventory: 3304 unused candidates (113 low, 55 four-star, 3136 five-star), 845 already English-ready. The selected 32 span 13 authorized establishments, have 5 existing Google/Apify English translation rows and 27 missing English versions. There are zero overlaps with previous used IDs, zero AI references, zero seals, zero paid authorizations, zero runs and zero tasks. After reserving these 32 reviews, 3272 unselected candidates remain. All selected original-text hashes match their live originals.

At persisted rates (input .042 USD/million, output 0), measured A usage from 94 past pass-1 reviews gives approximately .011385 USD for 32 new A calls. B remains unmeasured. The illustrative 64-call budget, **if B costs the same as A**, is .022770 USD, not a guaranteed compact cost or spending cap.

Validation passed: 1135 unit tests; four Deno tests with network denied and Deno type checks; SQL/RLS/role/hash/strata/idempotence assertions; lint/build; FR/VI Playwright widths 360/390/430/768 with no provider traffic or overflow. Live SQL found an import-loop alias collision; a separate corrective migration fixes it without changing the initial migration or any data. Both Edge Functions are deployed without creating an authorization or starting work. Unauthenticated comparison and worker requests return 401.

Fingerprints of all 56 pre-existing configuration, benchmark, reference, translation and cache tables stayed identical. The live reviews table received one new review through the pre-existing provider import at 09:21 UTC during development; this workflow performs no writes to reviews and all 32 selected originals stayed unchanged.
