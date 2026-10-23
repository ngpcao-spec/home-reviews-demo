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

The next continuation retained another 40 complete responses (318 distinct
responses total), then stopped before the next reservation. The deployed SQL
log identified the prior-attempt lookup, not dispatch: its generic plan joined
historical large protocol JSON before filtering a review. An indexed,
materialized candidate lookup now performs bounded primary-key probes instead.
With force_generic_plan, all 208 remaining SQL reservations completed in a
rollback test, maximum 49.719 ms. An injected unknown reservation was refused;
no dispatch occurred and the source run hash was unchanged. Eight concurrent
deployed PostgREST checks returned without error (maximum 221.7 ms including
network). Test archive: 86290357-102c-45fa-9ea7-dc7b7b711f8e.

Full-size qualification also exposed an Edge CPU limit during free Sol
preparation (2,580 ms, CPUTime). The free envelope and its token measurement
are now separate durable wakes. The server loads the immutable source
certificate itself; runtime still hashes the entire protocol and checks each
actual response, source text and native result, without repeating the sealed
per-request preparation checks. The selector memoizes only normalized word
sets within one invocation. On 526 frozen reviews / 1,438 candidate
associations, baseline and optimized selections and diagnostics were exactly
equal (32 associations, unchanged selector hash). Local selector CPU fell
from 1.359 s to 0.437 s; this is not a semantic quality assessment.

Deployed worker v48 qualified the same 610/526 source size through the actual
RPCs with explicit technical mock transport and zero supplier calls:
- envelope: archive 807c822c-68cb-4c16-b41e-5e91920da8d5, 1,929 ms Edge CPU,
  58,647,751 bytes recorded memory, normal EarlyDrop shutdown;
- token measurement/persistence: 12cced42-8690-4080-95d2-3e0ec256f63d,
  1,195 ms Edge CPU, 110,821,539 bytes memory; prepare RPC 3,772 ms wall;
- mock Sol receipt: 3e575665-d164-4fb5-b101-d6af481d247c;
- validation and final save: 4ee3cc47-af57-4856-a84c-7315efde21d9,
  technical_checks_passed true, one mock reservation, zero supplier calls.

The qualification run is excluded from paid caches and publication. Repeated
terminal wakes cannot dispatch a second mock call. These tests establish the
deployed technical path, not future supplier success or report truthfulness.
