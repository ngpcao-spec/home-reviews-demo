# Shabu V7 human Gold v1

Manual experiment only; no real Gold set or annotation is created by deployment.
Open Plus → Test Jev → Shabu V7 → Gold Set — Validation humaine. The block is
enabled only after the pinned V7 report and Phase 2 V7 benchmark are completed.
The user's Create click starts the first real set; reopening reads progress only.

- Sol source: `b73ec894-d5fd-4b11-9fe6-cd89c117e9de`.
- Jev source: `4c634678-17a9-47b3-89e1-fad0641f5d86`, three repetitions.
- Name: `shabu-v7-gold-v1`; methodology: `diagnostic_disagreement_v1`.
- Taxonomy: `gold-taxonomy-v1`, the 25 product-approved definitions in
  `_shared/gold-taxonomy.ts`. Change the version for any semantic revision.

## Selection and blinding

All inputs come from the immutable English V7 snapshot, never the live reviews
table. Selection reserves eight controls when available (at most two Choice
differences across 25 themes, ordered by SHA-256 review ID). The remaining 32
are ranked by priority Service disagreements, other Service, Atmosphere, then
Quality/Price; within tiers negative signals, unstable repeats and more
differences take priority, with a hash tie-break. Shortfalls use subsequent
candidates, retaining 40 textual reviews whenever possible. Presentation order
is hash-based and mixes controls/diagnostics. Excluding a translation preserves
position, never reuses an ID, and prefers another control when replacing one.

Annotation is a separate page. The API returns only English analysis text, its
position, saved human choices and frozen definitions. It never returns ratings,
originals, probabilities, model predictions, buckets or a draft comparison.
Unselected themes become absent only when the human confirms the review.
Uncertain remains a human choice, excluded from both polarity metrics. All
changes require explicit clicks. Confirmed reviews autosave transactionally;
pending chip changes must be confirmed before finalization. Reopening recovers
server labels and uses a local review ID only as a navigation hint.

## Persistence/security

`analysis_gold_sets`, `analysis_gold_set_reviews`, `analysis_gold_labels` hold
the experiment. `analysis_gold_events` is an append-only human edit/exclusion
audit, including prior labels. No review text is duplicated in these tables.
Per-text SHA-256 hashes, source and benchmark fingerprints detect tampering.
Creation is idempotent and serialized per pinned source pair. Review writes and
completion lock the Gold parent and verify its revision. Completed sets, labels,
reviews and audit are protected by database triggers, including service writes.

RLS is enabled on all four tables. Raw Data API privileges are revoked for anon
and authenticated, to keep buckets/draft comparisons private. `human-gold-set`
requires authentication, verifies owner/admin/manager membership from the source
organization and scopes all Gold reads. Service-only SECURITY INVOKER RPCs write
only Gold tables; they recheck membership. Other organizations cannot retrieve
this set by a guessed ID. No provider/model client or cron is introduced.

## Scoring

The server calculates and persists results only after explicit finalization of
40 validated reviews × 25 labels. Sol findings map to absent/positive/negative/
both. Jev averages the three probability vectors per review/theme, then thresholds
positive and negative presences at 0.50. Repetitions never multiply Gold support.
0.70 and 0.80 are exploratory only. Micro F1 pools TP/FP/FN without TN; macro F1
includes only Gold-positive supports >=3. Per-label supports, axes, exact Choice
agreement and repeat stability are separate. On unequal exact Choices, a single
Gold Choice cannot match both; that resolution bucket is explicitly zero.

The paired bootstrap resamples reviews 2,000 times using xorshift32 seeded from
SHA-256(gold_set_id). CI endpoints use sorted nearest lower-rank empirical
quantiles. Undefined F1 resamples are counted; any undefined resample makes the
directional verdict inconclusive. Otherwise CI entirely above/below zero yields
Jev/Sol better **on this diagnostic Gold only**. An interval including zero is
inconclusive. Always show the disagreement-enriched sampling warning.

No automatic production switch, new report, backfill, benchmark, evidence or
model call occurs at creation, annotation, completion or deployment.
