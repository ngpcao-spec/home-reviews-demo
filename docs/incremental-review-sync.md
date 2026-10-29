# Automatic incremental Google review sync

Version `google-reviews-incremental-v1` restores the automatic date boundary removed by commit `52d53e7564f0d3e556575ba60fd6241b7217ec44`. It does not revert that commit's latest-150 corpus policy. Manual initial imports and full reloads still request the newest 150 unique reviews, all stars, with or without text, without an age boundary, and retain the existing atomic reload path.

## Request and actor compatibility

| Parameter | Previous automatic worker | Corrected automatic worker | Manual initial/reload |
|---|---|---|---|
| Actor | `compass/google-maps-reviews-scraper` | Same actor | Unchanged |
| Build | Default `latest` | `0.0.541`, frozen with each reserved request | Unchanged default |
| Sort | `newest` | `newest` | `newest` |
| Date filter | Absent | `since` -> `reviewsStartDate`, UTC last validated review publication minus 5 seconds | Absent |
| `maxReviews` | 150, systematically rereading a window | 150 as a safety ceiling on the date-filtered response | 150 |
| Language/origin | Frozen FR/VI / Google | Same frozen language and Google origin | Unchanged |

The build used by the sampled saved production run and the actor's current default build was verified read-only as `0.0.541`, build ID `Wck4NsSOTMrHCVoAk`, actor ID `Xb8osYTtOjlsgI6k9`. Its input schema accepts ISO timestamps with time in UTC and requires newest sorting when filtering by date. The generated UTC input was checked against the published schema pattern; no real collection was started for validation. Sources: [actor build/schema](https://api.apify.com/v2/actor-builds/Wck4NsSOTMrHCVoAk), [actor documentation](https://apify.com/compass/google-maps-reviews-scraper).

The exact resolved input, actor build, server-side Google identity and protocol version are reserved durably before the existing single start POST. Unknown/unbound consumed starts remain terminal and are never replaced by a full import. Existing slots, lease fencing, scheduler frequency, cron recovery, application-closed operation and language freezing are preserved.

## Validation and atomic persistence

- Missing/invalid/future or stale checkpoints are explicit errors before a new paid request. No 30-day fallback, six-month cutoff, time-of-processing watermark or full reimport is substituted. The saved checkpoint must refer to a retained review with the same publication date.
- A known run/dataset is read again after interruption; it is not restarted. Legacy cursor-only bindings can be durably restored from their saved cursor. Input/version/identity inconsistencies fail closed. Native receipts and downloaded item counts are recorded before local validation, including failures.
- Every returned review must have the expected CID, a usable ID, a valid publication date and a rating. Duplicate IDs are collapsed; conflicting duplicate versions are rejected rather than arbitrarily rewritten. All IDs in the overlap are examined: finding a known ID does not stop reading, including other new IDs at the same timestamp.
- A short result is not evaluated against a target of 150. Three new reviews plus a known overlap can complete normally. A successful empty dataset records verification only and keeps the review watermark unchanged. This cannot prove the provider has omitted nothing; it does not move the date boundary and the next scheduled sync still covers it.
- For a nonempty result, require the saved checkpoint ID or an older publication to establish that the boundary was reached. A short result lacking this evidence is marked `SYNC_INCREMENTAL_BOUNDARY_NOT_REACHED`, without inserting, advancing the watermark or automatically recollecting. A deleted/unavailable checkpoint can therefore require investigation even if some new rows look valid.
- A new date-filtered run reaching the 150-item ceiling is explicitly incomplete (`SYNC_INCREMENTAL_LIMIT_REACHED`), including equal-timestamp saturation. It does not advance, publish a partial update, retry the paid start or fall back to a full import. Native failure/partial/billing/item-limit signals are also rejected. Provider omissions between returned rows cannot be independently disproved by a single response.
- An already consumed legacy full-window result can be reused only when older rows demonstrate it crossed the frozen date boundary. Its old rows are not reinserted. Legacy resumed-run metrics describe the storage state at reuse; missing historical insertion measurements are not invented.

`commit_incremental_review_sync` holds the same corpus advisory lock as ingestion/reload, locks the restaurant and job, verifies its lease, bound run/dataset, identity and reload barrier, then removes all IDs already present or recorded in the existing deduplication keys. Only new rows reach the existing ingestion function. The ingestion function itself is unchanged, including manual update/reload semantics. Its existing retention removes outgoing reviews and their derivatives.

An empty novelty set skips ingestion, retention and snapshot writes, preserving reviews, translations and report status. With new rows, insertion, translation/raw persistence, retention, an optional place snapshot, exact counter calculation and queue completion occur in one transaction. The watermark comes from the publication dates actually saved and retained, not a changed date supplied for an already known review or the worker finish time. Failure rolls the transaction back; the paid run binding/receipt remains reusable. Duplicate completed commits return the saved result without a second mutation.

New columns are nullable for existing jobs. New RPCs are service-role-only, security invoker functions; no end-user grant or public access is added. No existing report freshness is reset. The current report lifecycle marks a changed corpus stale and preserves its dated report until successful replacement. No report generation, price collection, recommendation-score update or AI model change is added.

## Accounting

`incremental_received` records raw downloaded items; `reviews_fetched` preserves the largest observed count for that run, avoiding duplicate accounting on a reread. `incremental_receipt` contains an allowlist of native run/status/accounting fields. Successful `incremental_result` records:

- `received`: downloaded items, including duplicates;
- `unique`: distinct returned Google review IDs;
- `already_known`: IDs already retained or present in deduplication keys;
- `outside_window`: distinct returned IDs outside the requested overlap;
- `added` / `removed`: actual before/after review-ID differences;
- `retained`: final corpus size, at most 150;
- frozen `since`, actual saved `head_id/head_at`, empty/legacy flags.

`already_known` and `outside_window` can overlap; they are not additive partitions. Failed validation does not invent unknown unique/inserted counts. Existing daily counters and provider-start reservations remain intact. Four accepted new reviews against a full corpus produce four additions and four removals. Zero new IDs leave the corpus and translations unchanged.

## Delivery and verification

Offline parser/provider tests and the real SQL migration run against PostgreSQL/PGlite cover UTC input, manual requests, duplicate/equal-time IDs, zero novelty, empty responses, four-review rotation, existing text/translation preservation, rollback, lease/worker fencing, known-run reuse, missing checkpoints, caps, late reload results, idempotency and privileges. Existing manual reload and initial-import tests are reused. No paid collection, AI call, report generation or manual worker wake validates deployment.

Apply only `20261029004621_incremental_review_sync.sql`, then deploy `process-review-sync-jobs` from the merged commit. Keep the configured monitoring schedule active. The next naturally scheduled run supplies the first real volume/duration/cost measurements after this fix; no measured saving is claimed in advance. Private before/after data and the deployment report stay outside the repository.

Rollback must keep the additive columns/RPCs and consumed run bindings. Do not revert wholesale to the previous worker, which would restore the full-window regression. If necessary, deploy a forward fix that continues to refuse new starts with missing/invalid incremental input; retain the existing queue, receipts and unknown-start guards. Do not trigger or replay jobs as part of rollback.
