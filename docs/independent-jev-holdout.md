# Independent V11/V12 Artisan benchmark

Route: `/plus/jev-independent-test`, linked from Plus → Test Jev.
Source: holdout `d7d7142c-03ef-48c3-b36e-bacf6d923f40`.

The 32 frozen English reviews and 800 blind ChatGPT classifications are read only. The seal predates this benchmark; these are AI references, not independently human-validated Gold. All uncertain choices are preserved and excluded from the corresponding positive/negative metrics. The old holdout set's legacy human-required metadata is preserved; this separate circuit uses the explicit blind-AI seal.

The existing seal is verified in SQL and TypeScript. Dataset fingerprint: SHA256 of `review_id:analysis_text_sha256`, joined by `|` in position order. Reference fingerprint: SHA256 of seven-field PostgreSQL `jsonb::text` records joined by `|` in the same position order: review ID, text hash, rubric, model source, reference kind, theme choices and overall text sentiment. Every individual text hash and annotation protocol is validated. No training-review overlap is permitted.

V11 calls its existing `v11Payload`; V12 calls its existing `v12Payload`. Questions and polarity thresholds are unchanged, snapshotted in configuration `independent-v11-v12-holdout-v1`. Both versions share the same English text and use 3 repeats, maximum concurrency 8, requested model `jev-latest`. No rating, original text, reference annotation or other-version prediction enters a Jev payload.

Four new tables: configurations, runs, tasks and results under `analysis_jev_independent_*`. Members with owner/admin/manager roles can read only their organization's run/task/result rows. All writes require the authenticated API or scheduler worker and service-only RPCs. Completed/failed runs and tasks, results and configurations are immutable.

GET prepares/validates an in-memory preview only. POST requires the current preparation/configuration hashes and explicit cost confirmation. Unique holdout/configuration and task keys prevent duplicate starts. A local pending marker reconciles ambiguous POST responses using GET; it never retries POST automatically. Server state survives PWA closure.

The conditional cron worker performs no request when no run is queued/running. Each task allows exactly one provider attempt. Expired in-flight tasks become unavailable (`JEV_RESPONSE_UNCONFIRMED`), never pending again. There are at most 192 evaluations. No automatic paid retries, Sol, Apify, new report or production activation.

Results use only reviews with all 3 valid responses in both versions for paired scores. They include polarity-specific precision/recall/F1, micro F1, macro F1 for theme/polarity support ≥3, exact agreement, 25 themes, 4 axes, potential FP/FN, repetition stability, disagreements, suspect reviews, served models, tokens, costs and timing. Missing responses are never counted as absent. A deterministic review-paired bootstrap uses 2000 resamples; incomplete/insufficient samples get null confidence bounds. Differences in served models are flagged.

Translation concerns recorded in reference notes and known English overrides are flagged for review. They never modify sealed English texts or existing translations. This detector cannot discover every previously unknown translation error.

Development/deployment only: no real benchmark is created or launched by migrations, GET, page loading, tests or deployment.
