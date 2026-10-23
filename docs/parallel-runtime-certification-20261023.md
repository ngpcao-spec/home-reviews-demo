# Runtime certificate and saved-receipt recovery

The first SQL/JIT correction alone was insufficient under concurrent dispatch.
The continuation `03836a9e-9ca5-45d2-b71e-76bb301be0a6` stopped on another
57014 inside `jls_restaurant_valid`, called by `begin_jls_restaurant_dispatch`
at 02:35:34 UTC. It retained 276 finalized answers, two additional complete
immutable response receipts, and two immutable outcomes explicitly stating
that provider fetch was never invoked. There are also 246 unreserved tasks.
No Luna or Sol call took place. Both stopped runs remain unchanged.

The common runtime guard now uses the existing immutable source-certificate
mechanism, rather than repeatedly inspecting a multi-megabyte JSON protocol.
The certificate binds the exact prepared hash, organization, establishment,
actor, sources and request configuration. Operational continuations additionally
bind their parent protocol, source manifest and immutable historical rows.
The active organization/establishment, membership, consent expiry and lease
are still checked at reservation and dispatch. No timeout is increased.

Recovery classifies only server records: a verified complete saved response;
an unreserved task; a reserved task with an immutable `provider_fetch_invoked:
false` outcome and no dispatch intent; or an unknown outcome. Unknown outcomes
are refused. This distinction follows the deployed worker, which sets its
fetch flag only after the transactional dispatch reservation succeeds.

The two successful receipts can be copied to a new continuation without
changing the stopped run. The two proven non-sends may receive their first
provider call. The cache handoff requires the exact certified proof and
archives the previous cache row before transferring its reservation. It never
releases a completed result or a potentially sent attempt. Previous receipts,
task states, classifications and probabilities are preserved.

The deployed worker v44 reuses the existing non-spending SQL qualification
route for parallel reports. Its mock transport exits before provider keys;
fixtures cannot read or populate the paid cache and never appear as reports.
Real service-role/PostgREST tests include eight concurrent claims, eight
dispatch reservations, receipt retention/finalization and four concurrent
wakes. Qualification archives: `640a89e9-10d0-4247-bec3-b722af7a590e` and
`e129c766-9f00-456d-bd3b-0e8c4c23c357`. Both returned HTTP 200 with zero provider
calls. RPC wall time includes network/queue time; it is not SQL CPU time.

Full rollback qualification on the saved corpus recovered 278 exact answers
and admitted 248 first sends (246 unreserved + 2 proven non-sends). It refused
an injected unknown reservation, reserved all 248 SQL mock tasks, created no
provider dispatch and preserved the source run. Creation measured 15,250 ms
as a separate administrative SQL operation; maximum individual SQL claim was
294 ms. This is a technical qualification, not a semantic evaluation.

JEV short instructions, category choices, selector, compact Sol prompt,
thresholds, production reports and Sol call limit remain unchanged.
