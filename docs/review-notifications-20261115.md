# Restore negative-review notifications (2026-11-15)

## Observed cause

Incremental ingestion uses `home.shared_jev_sync=on` to suppress the legacy
`analyze-review` invocation and enqueue shared JEV. Notification insertion and
push delivery existed only inside the legacy automatic reply callback.
Successful new-review JEV batches therefore left no notification behind.
Production diagnostics found 22 recent nonhistorical 1–3-star reviews without
notifications in the VI organization, including TITO and Smoky Pit. This was
not evidence of revoked iPhone permission: its subscription was still present.

## Change

Create an in-app alert transactionally when a new nonhistorical 1–3-star review
is inserted. A 4-star alert still requires `has_negative_feedback=true`.
Alerts no longer claim an AI reply is ready or depend on that analysis.
The existing organization-local review projections determine the recipients;
an active establishment, organization membership predating the review, and the
existing `historical_import` flag are required. Shared subscription backfills
already set that flag. No shared-catalog, translation or synchronization code
is modified.

An activation timestamp excludes existing reviews, including later updates of
their feedback flag. No backfill is performed. Existing notification IDs,
read states and RLS remain unchanged. Names/titles are localized from the
recipient's existing profile (VI/FR); review content is still rendered through
the existing read-only display RPC.

The existing unique `(user_id,review_id,type)` constraint prevents a second
notification when the old AI callback or a result replay runs. New rows enter
a private delivery queue. A scheduler-authenticated function reserves one row
atomically before push delivery; up to five are handled per invocation.
Recipients/read state are checked again before reservation. A failed or
uncertain push is never automatically retried. An interrupted reservation
becomes `unknown` after five minutes; the in-app notification remains readable.
This favors avoiding duplicate external delivery over claiming exactly-once
delivery, which the push provider cannot guarantee.

The scheduler runs each minute but invokes the Edge Function only when there
is pending/processing work. It reuses the existing Vault scheduler credential.
No secret, push endpoint or subscriber key is stored in this change.

## Validation

- 14 isolated PGlite/worker tests: eligibility, historical/cutoff exclusion,
  VI/FR recipients, organization separation and original notification RLS,
  legacy/replay uniqueness, racing worker requests, terminal outcomes,
  interrupted delivery, late receipts, removed members, read notifications,
  runtime disable and forbidden client RPC calls. Concurrent promises exercise
  real SQL claims in PGlite, not independent network Postgres sessions.
- 5 Edge handler tests: scheduler authentication, direct client rejection,
  no-op drain, reserved recipient and receipt persistence. Push is simulated.
- 19 existing push/UI tests and 38 existing shared-JEV SQL tests pass.
- 2 existing Playwright notification tests pass in Chromium's iPhone 14
  viewport with network providers blocked. This is not a real iPhone push test.
  The old browser fixture was updated to emulate `read_review_display`, which
  the actual UI now uses; the Vite test config gained its missing tokenizer alias.
- Lint and production build pass.

## Production verification

Activated 2026-11-15 04:34:38 UTC (11:34:38 Vietnam).
`process-review-notifications` version 1 is ACTIVE; all three retrieved source
files match the deployed bundle byte for byte. Bundle SHA-256:
`1d77ee2782ef5f464b4269eadf5ebfff9fe97801cbb39a39b238ff1caebd440b`.

The migration succeeded. Both review triggers and the minute scheduler are
active. The authenticated scheduler request 122885 returned HTTP 200 with
`{"version":"review-notifications-v1","processed":0}`. A direct unauthenticated
request returned HTTP 401. Authenticated clients cannot execute delivery RPCs;
the service role can. Existing notification count stayed 26 and the new queue
stayed empty: no retroactive alert or external test push was sent.

Security advisors show the same pre-existing warnings. The two new private
tables add only informational RLS-without-policy notices: deliberate denial
to client roles; service-role delivery uses its existing bypass role.
The next ordinary negative review and actual iPhone receipt have not yet been
observed. No collection, analysis, test notification, or client deployment was
needed for these server-side checks.

## Deployment and rollback

1. Deploy only `process-review-notifications` and its two shared dependencies
   (`push.ts`, `review-notification-worker.ts`). The handler authenticates its
   own scheduler token; platform JWT checking is disabled just for this function.
2. Apply only `20261115042449_restore_jev_review_notifications.sql`.
   No historical migrations, purge scripts or backfills are applied.
3. Check the trigger definitions, service-only grants, runtime activation time,
   cron job, unchanged historical notification counts and authenticated empty
   worker response. Do not create customer reviews or send test alerts.

Soft rollback (no data deletion):

```sql
update private.review_notification_runtime set enabled=false where singleton;
select cron.unschedule(jobid) from cron.job
where jobname='home-reviews-review-notifications-v1';
```

This stops new enqueue/claims, keeping notifications and receipts. An external
push already reserved may finish; no attempt is requeued. If the trigger itself
must be detached, also drop only `reviews_negative_notification_insert` and
`reviews_negative_notification_update` from `public.reviews`. Do not drop the
notification table, truncate receipts, alter review sync jobs, or rerun old AI.

Normal recovery from a disabled runtime requires explicit review of pending
rows before re-enabling; do not blindly resend `unknown`, `failed` or `sent`.
