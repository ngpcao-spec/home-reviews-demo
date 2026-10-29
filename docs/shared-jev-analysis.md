# Shared JEV analyses, V1

`shared-jev-initial-v1` shares classifications between successful incremental
syncs and future manual batch reports. Sol remains manual. No backlog is started
by the migration or activation.

## Existing components retained

The existing `analysis_jev_batch_runs/tasks`, `jev-batch-experiment` transport,
50-review/context planner, global native account slot, durable once-only
reservations, receipt recovery, immediate continuations and recovery cron are
used by both consumers. Automatic jobs have `purpose=new_reviews`, no report ID,
and a database constraint forbids any Sol attempt/envelope/draft. No second
provider transport, translation service, prompt, selector or scoring rule exists.

`commit_incremental_review_sync` queues only newly inserted **retained textual**
reviews, in its successful commit. Its scoped transaction flag suppresses the
old reply-analysis insert webhook for those inserts. Known reviews are not
rewritten. Initial import/reload, 150-review retention, incremental checkpoint,
language, translations, prices and practical metadata remain unchanged.

## Identity, reservation and native provenance

The unique SHA-256 covers organization, establishment, Google review ID, exact
analysed text SHA, actual analysis language (`und` if unknown), initial JEV model,
common configuration/instructions and parser compatibility. Ratings and text
length are not new model inputs or weights. Batch peers, UUID aliases and local
question numbers remain transport metadata on the original task and receipt.

A database transaction assigns one producer to an identity before planning.
Another automatic/manual consumer references that same identity and waits;
it cannot submit a second copy. The existing task reservation still occurs
durably before HTTP. Complete native results/probabilities, original task,
request/receipt hashes, original source UUID and native question keys are kept.
Reusing them does not fabricate an individual provider receipt or bill usage
again. The full report corpus supplies counts and selection, not just new texts.

Completed legacy native batches are adopted lazily only if Google linkage,
exact input/language, initial common instructions, served model and immutable
projection/receipt are provable. Normal source retirement also preserves proven
classifications of still-live review IDs before deleting the disposable batch.
No global backfill is installed. An unprovable
old result is not treated as compatible. Failed/unknown identities block rather
than silently allocating another attempt. Saved received responses are validated
without another HTTP call; a late saved response can be projected without
rearming or publishing its blocked generation.

## Frozen reports and lifetime

Future requests pin this feature version and their normal evidence selector.
Their full source, ratings, language and translations are frozen at enqueue.
New arrivals belong to the next report. A valid pin permits current-corpus
rotation while the frozen generation runs; reset epochs, reload barriers,
abandonments and expiry still reject obsolete publication. A completed dated
report from a changed corpus is published as stale; existing stale thresholds
and recommendation eligibility are not changed.

The snapshot/input deadline is 24 hours. The existing recovery cron removes
temporary automatic input and shared manual source copies after that deadline;
an already reserved HTTP attempt may drain until its existing 150-second lease
ends. Native accounting is retained in the existing content-free attempt ledger.
Removed-review results are retained only for unexpired consumers, then removed;
unknown/failed fences contain identity/provenance, no full review text. Results
needed by currently retained Google review IDs remain reusable. Existing legacy
historical publications are not rewritten or bulk purged by this delivery.

The existing server enqueue joins an active request across clicks/reconnects;
the existing one-shot Sol claim remains the final duplicate barrier. A failed
new report leaves the previous durable publication untouched. A deliberate new
request after completion remains possible.

## Deployment and activation

1. Merge only after CI passes; apply only
   `20261029042839_shared_jev_analysis.sql`. It installs disabled and enqueues
   nothing. Existing requests keep a null feature version and their old path.
2. Deploy the merged sources for `process-historical-report-jobs`,
   `jev-batch-experiment`, `process-jls-restaurant`, `generate-historical-report`,
   `get-historical-report-status` and `parallel-reports`. Deploy the normal Pages
   UI. The sync worker uses the updated atomic SQL RPC without a new deployment.
3. Verify deployed source files and existing request/publication fingerprints.
   Enable only with no legacy generation in flight (prevents a legacy planner
   racing the first shared producer):

```sql
begin;
set local role service_role;
lock table public.report_generation_requests in share row exclusive mode nowait;
do $$begin
 if exists(select 1 from public.report_generation_requests q
 join public.historical_report_runs s on s.id=q.source_run_id
 where q.shared_jev_version is null and s.status in('queued','running','retry'))
 then raise exception 'LEGACY_GENERATION_STILL_ACTIVE';end if;
end $$;
update private.shared_jev_runtime
set enabled=true,activated_at=clock_timestamp(),reason='Merged and verified shared JEV V1';
select * from private.shared_jev_runtime;
commit;
```

No generation, claim, wake or supplier call is a deployment probe. Never restore
older binaries while pinned requests exist. Disabling the flag affects future
requests only; it does not erase attempts or rearm jobs. A rollback to unshared
future requests must first wait for all producers/consumers to finish and for
unknown/failed fences to be resolved explicitly; otherwise leave the shared
manual coordination deployed. Never clear fences merely to permit rollback.

## Offline verification and limits

SQL tests run actual reservation, binding, receipt, projection, publication and
cleanup functions in local PostgreSQL (PGlite), with inert wake dispatch and no
network. They exercise both producer orders, zero missing, 146+4, textless,
duplicates, partial output, interruption, unknown/late response, language/input
changes, frozen rotation, reload/reset rejection and content-free expiry.
Worker tests verify full counts/selection, unchanged Sol input, one Sol claim
under concurrent simulated clicks, and preservation of the prior publication.

Private saved-data replay:

```powershell
$env:SHARED_JEV_REPLAY_DIR='<private saved receipts folder>'
npx vitest run --config vitest.shared-jev-replay.config.ts
```

The six saved 150-review corpora reproduce 668 textual results / 2,672 native
classifications and all 32 ordered associations per corpus. For a fair comparison,
proven Google IDs are added to **both** offline inputs, changing only auxiliary
source hashes. The resulting compact Sol request is identical between the two
selection paths. This is a technical replay, not a new quality evaluation or a
measured production speed/cost gain. Real cold starts, concurrent sync/manual
traffic, provider failures and ordinary UI refresh remain to observe in normal
use. No supplier calls are authorized merely to validate this delivery.
