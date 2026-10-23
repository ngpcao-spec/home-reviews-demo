# Launch certification for large experimental corpora

The Home Pizza click reached `parallel-reports` v4 on 2026-10-23 at
01:24 UTC. Request `01a1665b-c5dd-76ad-bce4-cfce792cd0f0` returned HTTP 409
after 14,162 ms. PostgreSQL logged SQLSTATE 57014 in
`start_parallel_report_internal`, line 33, at protocol insertion.
The REST SQL limit is 8 seconds. The transaction rolled back before creating
the run or tasks. This endpoint has no provider transport; the absence of
dispatch intents was checked independently of publication state.

The real frozen corpus contains 610 reviews, 526 textual and 84 textless.
The unchanged complete protocol is 2,874,738 JSON characters, including
repeated four-question request definitions. Local full verification took
about 0.5 CPU seconds. The SQL start took 12.0 seconds with JIT disabled.

`prepare_parallel_report` now certifies exact access, frozen sources, text
hashes, requests and the whole protocol hash into an immutable, server-only
receipt. Set-based materialized source joins replace repeated array scans.
`start_parallel_report_internal` can reuse only an exactly equal receipt
for the same actor, organization, report and generation. It rechecks current
report/access, holds the existing advisory lock, and atomically inserts the
protocol, consent, run, tasks and report association. The existing protocol
CHECK still verifies configuration and constituent hashes before commit.
Legacy starters without a certificate retain the complete verification path.
Neither stage opens provider transport. No SQL timeout or call limit is raised.

Rollback qualification on the real corpus measured 3,652 ms for certification
and 3,685 ms for queue creation. On deployed functions, certification measured
3,776 ms and queue creation 4,382 ms. A large SQL literal reconstructed by the
MCP profiling query also incurred caller-side JIT overhead; timings above
disable that profiling-query JIT. The RPCs themselves set JIT off.

The button continues to use `jev_categories4_short_common_1pass_v1`,
`jls-direct4-negative-mixed-coverage-v1`, `jls-direct4-compact-sol-v1` and balanced
synthesis V1.1. Luna/Apify caps remain zero, Sol one, provider retries zero.
The supplier-free complete local rehearsal used 526 explicit mock JEV answers
and one mock Sol answer, including validation and saved-result boundaries.
It is a technical rehearsal, not evidence of future semantic quality.

The FR/VI UI distinguishes preparation from a persisted processing stage,
shows the launch identifier, parses the HTTP error body, and provides a
read-only refresh after errors. A recovered persisted run suppresses stale
start errors. It never resubmits an uncertain launch automatically.

Qualification: `tests/supabase/parallel-launch-preparation.sql` runs under
the actual service role with all queue writes rolled back. UI/API tests cover
two-stage order, preparation failure, double clicks and lost-response recovery.
Production report content, JEV choices, selection semantics and Sol prose
instructions are unchanged.
