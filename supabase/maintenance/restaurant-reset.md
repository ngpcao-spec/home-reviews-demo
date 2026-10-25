# Restaurant reset and latest-150 policy

The reset is explicitly destructive and applies only to restaurant content. Do not run it as part of normal migrations or deployments.

1. Apply the reset barrier migration: pause corpus and ingestion writes, disable only previously active restaurant workers, and capture content-free UUID fences. Cron-log maintenance remains enabled.
2. Deploy and verify `latest_reviews_150_v1` and the importing/snapshot workers. No provider call is needed for deployment.
3. Verify no provider reservation with an unexpired lease remains. Execute `reset-restaurants.sql` as the database owner. It locks the inspected content tables, records consumed attempts without content, removes the two-way compact-text link, deletes children before parents, and restores user triggers in one transaction. Foreign keys remain enabled.
4. Verify every content table is empty and the account/membership fingerprints are unchanged. Storage objects and multipart uploads must also be checked through Storage; delete any actual files through the Storage API, never by deleting only SQL metadata.
5. Mark `private.restaurant_reset_control.completed_at` and restore only the jobs recorded there, then unpause ingestion and generation. This does not enqueue work; the empty database has no eligible restaurant or request.

Old restaurant UUIDs and import jobs remain fenced. Service-side restaurant creation requires a new, claimed, unexpired durable import job in the same organization. Old generation keys and consumed/unknown attempt hashes remain content-free. No request with an unknown result is retried.

Normal retention keeps at most 150 unique reviews ordered by publication date descending, then external ID in C collation, then UUID. All stars and textless reviews count. Earliest observed publication is immutable across duplicate imports; missing/future publication cannot be ranked and is rejected rather than replaced with ingestion time. No age cutoff applies. Only textual comments enter JEV. Corpus statistics use only retained reviews; category averages require an explicit valid category rating.

The previous dated report remains stale and visible while the current corpus changes or regeneration fails. Only a successful, compatible, current-scope report replaces it. Removed source texts and their derived copies are purged, and old references are shown as unavailable.

Browser display cache version 2 rejects pre-reset snapshots without removing authentication. Reload an already-open older client to load the new version.
