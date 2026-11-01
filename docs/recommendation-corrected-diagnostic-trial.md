# One corrected-protocol manual diagnostic trial

This mechanism prepares an explicitly authorized single comparison after the V2
validator fix. It does not authorize itself, call a provider, schedule work, edit
historical receipts, rearm an old grant or change recommendation rules.

The operator-only `authorize_corrected_recommendation_diagnostic_v1(parent_uuid)`
requires a definitively rejected V6 `IRRELEVANT_CAUTION` receipt with native
provider ID, output tokens and completion timestamp. It may link to a consumed
V1 diagnostic child, verifying that child's original root receipt as well.
One new grant ever per parent. Expiry is 24 hours, never reset by reauthorization.
No operator call is exposed to authenticated/anonymous clients.

On an explicit Compare click, the deployed preparer constructs the ordinary V7
request. A read-only V6 identity bridge independently reproduces the former
request and access/data cache SHA-256 using the same input, filters and current
authorized catalogue. Both must match the original receipt. The legacy payload
is never sent or stored. A mismatch blocks the call, without consuming the grant
or substituting an ordinary paid attempt. Do not reformulate the input to bypass
the check. A changed corpus/access scope requires a separate user decision.

The corrected reservation RPC pins coverage-v2, validator-v2, safety-v7 and server
version >=10. It reserves under the existing organization advisory lock and
concurrency ceiling. The linked child, consumed grant, current request hashes and
initial diagnostic commit together before HTTP. An existing compatible V7 receipt
blocks a duplicate. Completion and its final diagnostic are atomic. Failure to
persist completion leaves the dispatched reservation consumed, never resent.
Double clicks join that same child; an aged dispatched child is shown unknown.
Neither expiry nor another authorization can reset it. Corrected children cannot
be used to extend this mechanism into an automatic replay chain.

Only content-free hashes, IDs, version names and timestamps are retained in the
grant. Detailed diagnostics retain the existing bounded policy (7 days / 100 per
organization / 16 KiB each), without user free text, report excerpts or raw model
output. Diagnostics distinguish validation field, criterion position, reference,
provenance, permitted use and final origin. The client remains compatible and
does not trigger AI at load, on classic search or while changing filters.

Install only `20261101130715_recommendation_corrected_diagnostic_trial.sql` and
deploy only `test-restaurant-recommendations` with JWT verification. Do not arm
until the actual deployed source/versions and historical receipt are verified.
Then a separately authorized operator may run:

```sql
select public.authorize_corrected_recommendation_diagnostic_v1('<verified-parent-uuid>'::uuid);
```

This arming RPC does not reserve an attempt or call a provider. Inspect the new
grant and unchanged old receipts, then hand over the normal private page. No
watcher is installed. After the user's click, inspect the grant's fixed child ID,
receipt, saved validated selection and diagnostic. A historical missing raw reply
cannot be reconstructed or declared valid. Unknown/rejected results get no retry.
