# Automatic dated report refresh, V1

Future successful incremental sync commits evaluate the **same normal report
enqueue** used by manual clicks. The OR thresholds are 3 new 1–3-star reviews
or 25 new reviews of any rating. Textless reviews count. No collection, first
report, reload, provider call or backlog is started by installation/activation.

## Reference and counters

The latest technically validated durable publication in each establishment and
language owns a set of SHA-256 Google review identities. Counts are recomputed
against retained current reviews, not incremented/reset. Internal UUID changes,
repeat fetches, edited covered reviews and duplicates do not create novelty.
Reviews outside the latest 150 do not count. Overall rating alone determines
the 1–3-star count, independently of text, JEV or detailed numeric ratings.

New publications persist these identity hashes from their frozen source before
temporary data expires. Existing publications are initialized using demonstrable
ID mappings only. An incomplete mapping/invalid epoch requires a manual reference;
we do not invent identities or reinterpret current reviews as the frozen corpus.
No published document, score or existing stale status is rewritten by this step.

Example: 24 uncovered reviews, including two at 1–3 stars → no report. One
additional 5-star review → 25/2, one automatic request. Four more reviews,
including one 1-star, arrive while that 150-review snapshot is processed. On
successful publication the counters become 4/1, not zero. If generation fails,
the old publication/date/scores and all uncovered retained reviews remain.

## Shared work and paid-call fences

`shared-jev-initial-v1` remains the only analysis queue. New text comments in
unplanned same-establishment/language jobs can be coalesced immediately; there
is no wait to fill 50. Only current retained IDs can join that raw pending job.
Normalization uses compare-and-set so a racing worker cannot overwrite an
enlarged input. Normalized/planned jobs are immutable. The existing context-aware
planner, native probabilities, model/instructions and account slot are unchanged.
One available comment is one immediate eligible batch. Textless reviews need no
JEV. Existing compatible identities are reused; in-flight ones are awaited.

An analysis-only job retains its `purpose=new_reviews`/no-Sol constraint. Only a
normal report request authorizes the existing selector and one-shot compact Sol
over its whole frozen corpus. Auto requests pin `origin=automatic_thresholds`,
reference and observed counts at creation; manual requests pin `origin=manual`.
Both use the corpus lock, historical enqueue lock and active-request lookup.
Either kind joins the other. Language is frozen; the authorized account must
still belong to the organization and use that language at auto enqueue.

One durable automatic authorization per successful reference survives failure,
unknown result, source expiry and cleanup. Further syncs cannot start a paid
retry on the same reference. Failed/unknown JEV and Sol protections are retained.
Late response handling cannot authorize another automatic request or replace an
obsolete publication. A deliberate manual request still uses existing fences.

Publication updates the reference, then evaluates remaining arrivals. If its
source is still closing, a completion trigger continues immediately. The existing
recovery cron handles only queued checks as a fallback; it does not scan all
restaurants and authorize a deployment backlog. Failures remain recorded after
temporary source cleanup. Disabling automatic refresh does not disable shared
JEV, erase attempts, rearm work, or cancel authorized in-flight reports.

## Dated UI and internal recommendations

The report retains its date/frozen corpus, distinct from uncovered review counts
and refresh progress/failure. FR/VI failures are generic, without supplier names
or internal details. Reading the refresh state cannot enqueue or dispatch.

The internal deterministic engine accepts a coherent, valid dated report when
**only** `CORPUS_CHANGED` caused its stale state. It returns
`report.freshness=corpus_changed` and a dated-report notice. It does not clear
stale flags or recalculate scores. Unknown stale reasons, invalid publications,
rights, missing scores, closure and all other eligibility checks remain in force.

## Delivery

Apply `20261029081147_automatic_report_refresh.sql` and
`20261029084010_retire_obsolete_report_refresh_checks.sql`, then deploy the merged
sources used by `jev-batch-experiment` (four-argument normalization),
`process-historical-report-jobs`, `process-jls-restaurant`,
`generate-historical-report`, `get-historical-report-status`, `parallel-reports`,
and the normal Pages UI. Internal recommendation code is shipped with its
existing consumers; no public recommendation endpoint or HOME AI is added.
The existing sync binary calls the updated atomic RPC without another transport.
Verify served source hashes and CI before enabling:

```sql
begin;
set local role service_role;
update private.automatic_report_runtime
set enabled=true, activated_at=clock_timestamp() where singleton;
select * from private.automatic_report_runtime;
commit;
```

Do **not** call a check/enqueue/recovery RPC as a deployment probe. Future-only
rollback is `update private.automatic_report_runtime set enabled=false where
singleton;` as service_role. Keep compatible binaries, reference hashes and
attempt fences for existing work. Never clear an unknown outcome to allow retry.

## Verification and ordinary-use measurements

Local PostgreSQL tests execute the real patched enqueue, frozen source and
reference/counter functions, with inert dispatch and no HTTP. Existing shared
native receipt/unknown/partial/publication tests also run. UI and recommendation
tests retain dated reports and localized states. Source and global locks serialize
the tested reservation decisions; offline tests do not measure production race
latency or supplier availability.

Future native JEV receipts record their one real request/usage, with reusable
source provenance; reused results are not billed again. Auto report requests
have reference/count/origin and normal durable Sol receipts. Measure actual
attempts, HTTP duration and native token fields in ordinary use. Simulations
prove neither an actual saving nor future Sol content quality.
