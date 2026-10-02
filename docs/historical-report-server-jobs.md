# Historical reports: server-owned orchestration

## Contract

- An authenticated manual POST to generate-historical-report enqueues a run and returns 202.
- Enqueue verifies the establishment's organization membership and the profile language.
- Active states: queued, running, retry. Transactional enqueue plus a partial unique index
  guarantee one active generation per organization/establishment/language.
- Explicit retry of a failed run retains its immutable snapshot and paid checkpoints.
- Regenerating a completed report creates another generation; the published report stays
  visible until its replacement is committed successfully.
- Old clients sending generation_id only read status; they cannot execute batches.
- Analytics observes status every 5 seconds while mounted, visible and online.
  Leaving, closing, or suspending the page does not cancel or drive server work.

## Worker and recovery

process-historical-report-jobs is called by home-reviews-historical-report-worker-v1
every minute. It authenticates the private existing scheduler token, never a browser token.
The worker awaits one durable unit per claimed run: snapshot preparation, one extraction
batch, or finalization. Maximum concurrency is TWO globally, even across overlapping cron
invocations. The SQL global-capacity lock and TypeScript constant must be changed together
if this limit is deliberately revised later.

Claim uses an advisory transaction lock, row locks with SKIP LOCKED, a worker UUID and a
240-second lease. Different languages for the same establishment do not run concurrently.
Every checkpoint/publication checks run ID, generation ID, worker ID, cursor and lease expiry.
Cursor advances atomically with findings and classifications; stale workers cannot commit.

Transient network/provider 429/5xx/storage failures retry after 60, 180, 600, 1800 seconds.
Five consecutive attempts exhaust the retry budget. Successful durable units reset it.
Expired leases are reclaimable; repeated crashes also exhaust this bounded budget.
Validation failures remain definitive. Existing V3 grounding/fallback/calculation code is
unchanged.

The final narrative is staged durably before publication. Report replacement and completed
status are one database transaction. Publication retries reuse the staged result.
As with any external API, a crash between a paid response and its first durable checkpoint
can require repeating that *uncommitted* unit. No already committed batch is replayed.
Token usage is marked incomplete after an uncertain response/crash; no exactly-once billing
claim is made for that unavoidable boundary.

## Deployment and validation — 2026-10-02

- Migrations 20261002145715 and 20261002150158 applied. The first creates the cron disabled;
  the second enables it only after function deployment.
- Deployed: process-historical-report-jobs, generate-historical-report,
  get-historical-report-status. No other worker/provider functions changed.
- Worker rejects unauthenticated POST with 401.
- Real pg_net worker requests returned 200 at 15:02 and 15:03 UTC.
- 316 unit/integration tests; 28 browser lifecycle tests; 4 compiled offline PWA tests.
  Browser tests use controlled server state, not production AI. No physical iPhone test.
- tests/supabase/historical-report-jobs.sql exercised dedupe/index enforcement, global
  concurrency, lease fencing/recovery, retry delay, publication and regeneration in a
  rolled-back transaction. No production report or review was changed by these fixtures.
- Lint and production build passed.

K.HOUSE had ALREADY completed before this change. It was deliberately not regenerated:
generation d3d76526-cf53-49a0-8530-92a097d3177f, cursor 5, 6 AI calls, 259 findings.
MD5 of all findings: 01f9e4490cce95fabe41a442330c03a0.
MD5 of its first 168 findings: 1909fc30eee27ea85dcccfd1675ea5de, matching the earlier
cursor-3 checkpoint exactly. A controlled worker test covers adoption of cursor 3/168
findings; the live cron could not demonstrate advancing that already-completed run.

Security advisor: no new historical RPC is available to anon/authenticated. The runs table
remains server-only (RLS enabled, no client policy). Existing unrelated warnings about
pg_net placement, older security-definer RPCs and password protection were not modified.
See [Supabase database advisor](https://supabase.com/docs/guides/database/database-linter)
and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
