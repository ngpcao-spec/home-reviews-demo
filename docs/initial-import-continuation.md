# Initial imports: durable immediate wake and bounded Apify wait

The original queue was durable but only its minute cron started workers. A five-second `available_at` delay did not schedule a five-second resumption. The three saved imports showed 56.140 s, 49.408 s and 9.624 s before first claim and approximately 64 s from claim to completion. Native provider completion was not recorded, so those 64 s cannot be attributed entirely to cron waiting.

New jobs are woken through `pg_net` after their enqueue transaction commits. The same durable mechanism schedules eligible continuations, including the original five-second delay. No migration dispatches an existing job. The minute cron remains active as recovery if dispatch fails. A failed dispatch keeps the queued job and records `INITIAL_IMPORT_WAKE_FAILED_CRON_RECOVERY`, without logging credentials.

The current worker explicitly passes its existing concurrency setting as the fourth claim argument. Claims share an advisory lock and an active-lease budget bounded by the existing provider-slot configuration. Older workers using the three-argument claim cannot claim work: they lack the durable paid-start reservation. The provider-slot count, worker configuration, lease configuration, 150-review policy, languages, notes, JEV and Sol are unchanged.

For Apify, a durable reservation precedes the POST. The returned run and dataset IDs must be checkpointed before polling. Each invocation performs at most two known-run GETs with `waitForFinish=20`; a terminal success proceeds immediately to retrieval and persistence. A still-running run is queued for a five-second server continuation, preventing a hot loop if the provider answers early. This option is documented in [Apify Get Actor run](https://docs.apify.com/api/v2/actor-run-get); no webhook or new provider configuration is needed. The wait is independent of the browser.

A lost start response, or a received run ID that could not be saved, leaves an unknown durable reservation. Neither automatic recovery nor manual retry may issue another POST. A known run survives read, retrieval and persistence errors and is read again using its original identity. Native terminal failures remain attached and do not automatically start another paid run; an explicit manual retry may create a new attempt only after that terminal result was observed, retaining the previous technical run identity. Changed provider identities are rejected.

## Timing

All old timing fields remain intact; new fields are null on old imports. `created_at` is durable demand creation, `started_at` is first database claim, and `worker_started_at` begins processing. `provider_start_attempted_at` is the reservation before POST; it does not prove the provider received it. `provider_run_saved_at` is the persisted response identity. `provider_started_at` and `provider_finished_at` come from native Apify timestamps when supplied. `provider_finished_observed_at` is the server's first terminal observation. Retrieval and persistence each have started/completed timestamps. `finished_at` is the final durable publication of the imported restaurant. These server intervals include database and I/O work; none is pure CPU time.

`resolve-establishment` retains its existing search algorithm and adds start/end timestamps and a duration to its existing diagnostic log, returned with a correlation UUID. That UUID is carried into `initial_import_jobs.resolution_diagnostic_id`. Search duration must be read from the server diagnostic with this UUID; client-supplied numeric durations are not stored as server measurements. Resolution is measured separately and is not part of `created_at → finished_at`.

Use `supabase/maintenance/measure-initial-import.sql` for the next user-started import, replacing its placeholder only after UUID validation. Keep native finish time and observed finish time distinct. Missing fields remain unknown. No iPhone display time is measured.

## Release and verification

Apply the migration only when no import is running, then deploy `process-initial-import-jobs`, `add-establishment`, `resolve-establishment` and `retry-establishment-import`, preserving their existing authentication settings. No authorized worker invocation or paid provider run is required to verify deployment: inspect definitions, credentials compatibility as a boolean, the cron state, deployed files and an unauthorized worker request (401). PostgreSQL and provider simulations cover duplicates, lost leases, unknown POST outcomes, failed identity saves, native failures, bounded polling, persistence interruption, tenant access and wake failure.

The expected improvement is removal of minute-boundary waits when immediate dispatch works. Initial Edge startup, real provider duration, database operations, capacity waiting and error backoff remain. Real gain can only be measured on the next import started by the user.

## Safe rollback of immediate dispatch

Disable only these triggers to use the cron fallback again, retaining new worker safeguards and consumed attempts:

```sql
alter table public.initial_import_jobs disable trigger initial_import_insert_wake;
alter table public.initial_import_jobs disable trigger initial_import_continue_wake;
alter table public.initial_import_jobs disable trigger initial_import_release_wake;
```

Re-enable the same three triggers to restore immediate scheduling. Do not restore the old retry/reset code, clear provider IDs, replay a start reservation, change the cron or enqueue/resume an existing job as part of rollback.
