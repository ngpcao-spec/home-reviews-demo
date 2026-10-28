# Review collection coverage and explicit retry

The technical status of a collection is distinct from its coverage. A successful provider run can finish before collecting the requested reviews. Technical completion remains `initial_import_jobs.status = completed`; `result.collection` records the outcome and `result.importStatus = partial` prevents the UI from presenting partial data as a successful import.

The target is `min(150, reliable Google total)`. Count distinct, valid provider review identifiers returned by that attempt, after the existing normalization and stable deduplication. The worker already checkpoints this value as `reviews_fetched`. Do not use `reviews_inserted` or the current number of stored reviews to infer coverage: an overlapping recollection can return 150 reviews and insert no new identifiers, while five newly fetched reviews remain partial even if older data already fills the retained corpus.

The worker supplies the native Google count as the scalar `reportedGoogleTotal` before the existing retention trigger removes raw snapshot payloads. Non-integer, missing or inconsistent totals remain unknown; reaching all 150 distinct reviews proves that the cap is satisfied even when the larger Google total is unavailable. No language, text, date, sentiment or star filter is added. The existing publication-date validity checks and the policy retaining the newest 150 unique reviews remain unchanged.

## Existing imports

The migration reconstructs coverage from the saved attempt and its frozen snapshot, never from the current review corpus. Older first-wake completions used an `initial-job:<job>:direct` snapshot key because their in-memory job had not been updated with the saved run identity. That legacy snapshot is accepted only within the attempt's timestamps and when its positive numeric Google total agrees with the independently saved restaurant resolution. Otherwise a sub-150 historical coverage remains unknown. The worker now passes the actual saved run identity to persistence, so future snapshot keys identify the exact run.

No attempt is queued, resumed or dispatched during the migration. It requires no pending/running initial imports or sync jobs and takes NOWAIT table locks. If busy, allow already engaged work to finish and repeat the migration installation; do not invoke a worker or reset any attempt.

## Manual recollection

The already imported restaurant stores its collection state and keeps its existing ID and reviews. The normal detail page displays the approved account-language message and retry button. Its retry RPC locks the restaurant, then the import job. The sync scheduler uses the same restaurant lock. Any pending sync or unknown start prevents a new collection. A guard also skips sync inserts/claims while an initial import is active or partial.

Only an explicit authenticated click may replace a partial attempt whose successful terminal result, run ID, dataset ID and observed finish are saved. Before clearing the identity for a new attempt, the RPC appends the previous run, counts, result and phase events to `provider_attempt_history`. It sets the target to 150 and joins repeated clicks to the same queued job. Existing durable paid-start reservations and provider-slot limits remain unchanged. A lost/unknown start is never resent. Known runs retained after read/persistence errors are read again rather than started again.

The original restaurant stays active during recollection. No review DELETE or corpus reset occurs. Persistence uses the existing upsert/deduplication and 150-review retention; only the normal outgoing older reviews can leave when newer data fills that cap. Failure restores the alert. Full coverage clears it and restores the usual monitoring schedule. Partial/retrying imports have `next_sync_at = null`; no automatic fresh collection and no successful-import push are generated for a partial result. No report generation is introduced.

## Display and access

Use the exact FR/VI strings in `messages.add.importError` and `messages.add.retryImport`. No native error text is displayed. The server records rejection details internally. Existing organization membership, privileged role and original requesting-account checks remain required; private helpers have no anonymous/authenticated execute grant. Existing reports and model settings are unaffected.

## Verification and release

Offline PostgreSQL/provider simulations cover successful 5/150 and real 5/5, duplicate rows, zero new inserts, missing/invalid counts, sanitized raw snapshots and legacy keys, backfill with zero dispatch, two requests joining one attempt, pending syncs, unknown outcomes, failed recollection, tenant access and preservation of stored reviews. UI tests cover the existing restaurant, FR/VI, a locale change, single manual dispatch, active-attempt polling and warning removal only after server-confirmed completion. These simulations do not prove that a new real collection will paginate successfully.

After CI succeeds, merge the PR, deploy `process-initial-import-jobs` and `retry-establishment-import` from the merge commit with their existing authentication settings, then apply only `20261028064035_review_collection_coverage_and_manual_retry.sql`. The usual main-branch Pages workflow deploys the UI. Verify the installed definitions, deployed file hashes, migrated coverage, unchanged run identities/review IDs/reports, and the published UI assets without invoking a collection or generation endpoint. The user performs the first paid retry manually.

If reverting the UI, retain the coverage columns, receipt history and server guards. Do not restore the old retry routine, clear consumed reservations, enqueue existing attempts, or re-enable automatic collection for a partial restaurant as part of rollback.
