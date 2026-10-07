# Shabu human final adjudication v1

Manual, isolated check of completed Gold `1d5cfc8c-ac77-4e44-a7a7-6153eb132385`.
The frozen V7 report is `b73ec894-d5fd-4b11-9fe6-cd89c117e9de`; frozen Jev Phase
2 V7 is `4c634678-17a9-47b3-89e1-fad0641f5d86`. Existing scores/labels and
gold-taxonomy-v1 definitions are only read. No original Gold, report, review,
translation or benchmark row is updated. No provider/model client or cron exists.

## Manual selection

Selection runs only on the explicit Create POST, never on page load or deployment.
Candidates are the 40 active original Gold reviews with nonempty English snapshot
analysis_text. Conflict means any unequal pair among Gold, Sol and Jev Choices.
Sol maps persisted positive/negative findings into four Choices. Jev uses mean
presence probabilities over the three frozen repeats at threshold 0.50, exactly
as the original Gold comparison. These are deterministic projections, not new
model evaluations.

Each conflicting theme adds its weight (attention/professionalism 5, atmosphere
4, friendliness/coordination 3, communication 2, other 1), plus 2 for Sol/Jev
disagreement, 2 when Gold matches exactly one model and 1 for unstable Jev Choice
across repeats. Review scores sum these contributions. Sort score descending,
SHA256(review_id) ascending. Keep the top three conflicting themes per review
in the requested priority order, including cooking before other fallbacks.

Deterministic augmenting-path allocation reserves distinct review slots for
3 attention, 3 professionalism, 2 atmosphere and 4 other-theme cases when
possible, then fills missing slots in ranked order. Reviews may count toward
multiple achieved theme quotas; achieved counts and scoring metadata are stored
privately. Fewer than twelve conflicting reviews rejects creation rather than
inventing themes or recycling review IDs. No actual twelve-item production
selection is performed during development or deployment.

## Annotation and security

The original Gold results page adds the entry below its results. Annotation is a
separate route `/plus/gold-check`, restored per account on PWA reopen. It displays
English analysis_text, 1–3 theme names, exact frozen Gold definitions and only the
human's own saved choices. Original/rating/author, Gold/model Choices and
probabilities are absent from draft API responses. No default Choice is set.
Every tap saves one explicit choice transactionally; Next is disabled until all
themes on the current review have an answer. Uncertain is an explicit answer,
but never validates either model. Finalization requires 12 complete reviews and
another explicit confirmation.

Four new tables hold adjudications, items, labels and append-only edit audit.
Only review IDs, themes and text hashes are stored in items; texts remain in the
snapshot. Parent rows store source lineage, taxonomy, immutable-source fingerprint
and methodology `human_final_adjudication_v1`. Creation is idempotent under a
source-Gold advisory lock. Autosaves/finalization lock the parent and verify its
revision. Completed parents, items, labels and audit are protected by triggers.
Old tables have no write capability in this API.

RLS is enabled and raw anon/authenticated privileges revoked; authorized
owner/admin/manager reads go through `human-gold-adjudication`, with organization
filters and membership checks. Service-only SECURITY INVOKER RPCs recheck roles.
Text hashes, original Gold/model fingerprints and selected item shapes are
verified before reads/writes. Human edit actor, previous choice and timestamp are
audited. Cross-tenant guessed IDs return no data.

## Completed results

Only completion reveals Human / old Gold / Sol / Jev per targeted label. Gold and
model agreements use non-uncertain human labels as their denominator; empty
denominators return unavailable. Raw `gold_mismatch` stores exact inequality,
including uncertain differences, but non-comparable uncertain rows are counted
separately and excluded from definitive mismatch cards and all agreement rates.
Nothing rewrites old Gold. The screen gives targeted counts for attention,
professionalism and atmosphere, exact model disagreements, and an English-text
accordion for completed mismatch cases. Coherence thresholds are informational
(>=95, >=90, <90); no Gold v2 is created automatically. The difficult-sample
warning is always shown with completed results. This is not global accuracy.

During deployment no real adjudication, items, labels, model calls or source
mutations are created. First real start belongs to the user on iPhone.
